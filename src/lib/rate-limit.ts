/**
 * 🛡️ IP 级别速率限制工具
 *
 * 基于 Redis 滑动窗口实现，适用于登录/注册等敏感接口。
 * 每个 (action, ip) 维度独立计数。超出阈值返回重试等待秒数。
 */

import { redis } from '@/lib/redis'
import { NextRequest } from 'next/server'
import net from 'node:net'

// ============================================================
// 类型
// ============================================================

export interface RateLimitConfig {
    /** 限流窗口时长（秒） */
    windowSeconds: number
    /** 窗口内最大请求数 */
    maxRequests: number
}

export interface RateLimitResult {
    /** 是否被限流 */
    limited: boolean
    /** 剩余可用次数 */
    remaining: number
    /** 限流重置时间（秒数，仅 limited=true 时有意义） */
    retryAfterSeconds: number
}

// ============================================================
// 预设配置
// ============================================================

/** 登录：60 秒内最多 5 次 */
export const AUTH_LOGIN_LIMIT: RateLimitConfig = {
    windowSeconds: 60,
    maxRequests: 5,
}

/** 验证码发送：单个可信客户端来源 60 秒内最多 10 次，手机号维度另有独立冷却和日限额。 */
export const AUTH_SMS_SEND_LIMIT: RateLimitConfig = {
    windowSeconds: 60,
    maxRequests: 10,
}

/** 图形验证码：单个可信客户端来源 60 秒内最多创建 20 个一次性挑战。 */
export const AUTH_CAPTCHA_ISSUE_LIMIT: RateLimitConfig = {
    windowSeconds: 60,
    maxRequests: 20,
}

/** WeChat QR attempts call a provider API and allocate short-lived server state. */
export const AUTH_WECHAT_ATTEMPT_LIMIT: RateLimitConfig = {
    windowSeconds: 60,
    maxRequests: 10,
}

/** One attempt opens one event stream; reconnects remain bounded per client source. */
export const AUTH_WECHAT_STREAM_LIMIT: RateLimitConfig = {
    windowSeconds: 60,
    maxRequests: 20,
}

/** Public-beta reservation: one client source may register five numbers per hour. */
export const PUBLIC_BETA_WAITLIST_LIMIT: RateLimitConfig = {
    windowSeconds: 60 * 60,
    maxRequests: 5,
}

// ============================================================
// 核心逻辑
// ============================================================

/**
 * 检查并递增速率限制计数器。
 *
 * @param action  限流动作名（如 "auth:login"），会拼入 Redis key
 * @param ip      客户端 IP
 * @param config  限流配置
 */
export async function checkRateLimit(
    action: string,
    ip: string,
    config: RateLimitConfig,
): Promise<RateLimitResult> {
    const key = `rate_limit:${action}:${ip}`
    const now = Date.now()
    const windowMs = config.windowSeconds * 1000

    // Lua 脚本：原子地清除过期条目、添加当前请求、返回当前窗口内请求数
    const luaScript = `
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local windowMs = tonumber(ARGV[2])
    local maxRequests = tonumber(ARGV[3])
    local expireSeconds = tonumber(ARGV[4])

    -- 移除窗口之前的条目
    redis.call('ZREMRANGEBYSCORE', key, '-inf', now - windowMs)

    -- 当前窗口内的请求数
    local count = redis.call('ZCARD', key)

    if count < maxRequests then
      -- 未超限，添加当前请求
      redis.call('ZADD', key, now, now .. ':' .. math.random(100000))
      redis.call('EXPIRE', key, expireSeconds)
      return { 0, maxRequests - count - 1, 0 }
    else
      -- 已超限，计算最早条目的过期时间
      local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
      local retryAfterMs = 0
      if #oldest >= 2 then
        retryAfterMs = tonumber(oldest[2]) + windowMs - now
        if retryAfterMs < 0 then retryAfterMs = 0 end
      end
      return { 1, 0, retryAfterMs }
    end
  `

    try {
        const result = await (redis as ReturnType<typeof redis.duplicate>).eval(
            luaScript,
            1,
            key,
            now,
            windowMs,
            config.maxRequests,
            config.windowSeconds + 10, // TTL 略长于窗口以防边界
        ) as [number, number, number]

        return {
            limited: result[0] === 1,
            remaining: result[1],
            retryAfterSeconds: Math.ceil(result[2] / 1000),
        }
    } catch {
        // 认证入口在限流状态不可判定时必须失败关闭，避免 Redis 故障变成暴力破解窗口。
        return { limited: true, remaining: 0, retryAfterSeconds: config.windowSeconds }
    }
}

// ============================================================
// 辅助：提取客户端 IP
// ============================================================

/**
 * 从 NextRequest 提取客户端真实 IP。只有显式配置的可信代理跳数可以授权
 * x-forwarded-for；否则客户端可自行伪造该请求头绕过限流。
 */
export function getClientIp(req: NextRequest): string {
    // Next.js 14+ 的 ip 属性
    if ('ip' in req && typeof (req as NextRequest & { ip?: string }).ip === 'string') {
        const directIp = (req as NextRequest & { ip?: string }).ip?.trim() || ''
        if (net.isIP(directIp)) return directIp
    }

    const trustedProxyHops = Number.parseInt(process.env.TRUSTED_PROXY_HOPS || '0', 10)
    if (Number.isSafeInteger(trustedProxyHops) && trustedProxyHops > 0) {
        const forwarded = (req.headers.get('x-forwarded-for') || '')
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
        const clientIndex = forwarded.length - trustedProxyHops
        const clientIp = clientIndex >= 0 ? forwarded[clientIndex] : ''
        if (clientIp && net.isIP(clientIp)) return clientIp
    }

    // 无法验证来源时聚合到一个共享桶，不能把它伪装成 loopback 身份。
    return 'unresolved-client'
}
