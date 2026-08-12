import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, throwApiError } from '@/lib/api-errors'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { createScopedLogger } from '@/lib/logging/core'
import { checkRateLimit, getClientIp, type RateLimitConfig } from '@/lib/rate-limit'

/**
 * 客户端错误上报入口。
 *
 * 鉴权取舍：错误边界同样覆盖登录页 / 落地页等匿名页面，若强制登录，
 * 匿名页面的前端崩溃将继续 100% 丢失。因此仍先复用 requireUserAuth
 * 识别登录态，登录用户按 userId 限流；未登录不拒绝，但落入更严格的
 * IP 限流桶。该端点只写日志、不读写任何业务数据，不扩大攻击面。
 */

/** 登录用户：每用户 60 秒最多 30 条 */
const AUTHED_CLIENT_LOG_LIMIT: RateLimitConfig = {
  windowSeconds: 60,
  maxRequests: 30,
}

/** 匿名来源：每 IP 60 秒最多 10 条（更严） */
const ANONYMOUS_CLIENT_LOG_LIMIT: RateLimitConfig = {
  windowSeconds: 60,
  maxRequests: 10,
}

/** 单条上报体上限（字节） */
const MAX_BODY_BYTES = 16 * 1024

const MAX_MESSAGE_LENGTH = 2_000
const MAX_STACK_LENGTH = 8_000
const MAX_URL_LENGTH = 1_000
const MAX_USER_AGENT_LENGTH = 400
const MAX_ID_LENGTH = 128

const EXTENSION_SOURCE_PATTERN = /(?:chrome|moz|safari-web)-extension:\/\//iu
const SENSITIVE_KEY_VALUE_PATTERN = /(["']?(?:access[_-]?token|refresh[_-]?token|token|authorization|cookie|password|secret|api[_-]?key)["']?\s*[:=]\s*["']?)[^\s,"'}]+/giu
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu

function sanitizeClientDiagnosticText(value: string): string {
  return value
    .replace(SENSITIVE_KEY_VALUE_PATTERN, '$1[REDACTED]')
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(JWT_PATTERN, '[REDACTED_JWT]')
}

function sanitizeClientUrl(value: string): string {
  try {
    const url = new URL(value)
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return value.split(/[?#]/u, 1)[0] ?? ''
  }
}

const CLIENT_ERROR_KINDS = ['error', 'unhandledrejection', 'react-render'] as const
type ClientErrorKind = (typeof CLIENT_ERROR_KINDS)[number]

interface ClientLogPayload {
  kind: ClientErrorKind
  message: string
  stack?: string
  url: string
  userAgent: string
  requestId?: string
  projectId?: string
}

function isClientErrorKind(value: unknown): value is ClientErrorKind {
  return typeof value === 'string' && (CLIENT_ERROR_KINDS as readonly string[]).includes(value)
}

function readRequiredString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

function readOptionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, maxLength)
}

function parseClientLogPayload(raw: unknown): ClientLogPayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>

  if (!isClientErrorKind(source.kind)) return null
  const message = readRequiredString(source.message, MAX_MESSAGE_LENGTH)
  const url = readRequiredString(source.url, MAX_URL_LENGTH)
  const userAgent = readRequiredString(source.userAgent, MAX_USER_AGENT_LENGTH)
  if (!message || !url || !userAgent) return null

  return {
    kind: source.kind,
    message,
    url,
    userAgent,
    stack: readOptionalString(source.stack, MAX_STACK_LENGTH),
    requestId: readOptionalString(source.requestId, MAX_ID_LENGTH),
    projectId: readOptionalString(source.projectId, MAX_ID_LENGTH),
  }
}

export const POST = apiHandler(async (request: NextRequest) => {
  const contentLength = Number.parseInt(request.headers.get('content-length') || '0', 10)
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throwApiError('INVALID_PARAMS', { message: 'Client log payload too large' })
  }

  const authResult = await requireUserAuth()
  const userId = isErrorResponse(authResult) ? null : authResult.session.user.id

  const rateResult = userId
    ? await checkRateLimit('client-log:user', `user:${userId}`, AUTHED_CLIENT_LOG_LIMIT)
    : await checkRateLimit('client-log:anon', getClientIp(request), ANONYMOUS_CLIENT_LOG_LIMIT)
  if (rateResult.limited) {
    throwApiError('RATE_LIMIT', { retryAfterSeconds: rateResult.retryAfterSeconds })
  }

  const rawBody = await request.text()
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    throwApiError('INVALID_PARAMS', { message: 'Client log payload too large' })
  }

  let parsedBody: unknown
  try {
    parsedBody = JSON.parse(rawBody) as unknown
  } catch {
    throwApiError('INVALID_PARAMS', { message: 'Client log payload is not valid JSON' })
  }

  const payload = parseClientLogPayload(parsedBody)
  if (!payload) {
    throwApiError('INVALID_PARAMS', { message: 'Client log payload failed validation' })
  }

  if (
    EXTENSION_SOURCE_PATTERN.test(payload.message)
    || (payload.stack ? EXTENSION_SOURCE_PATTERN.test(payload.stack) : false)
  ) {
    return NextResponse.json({ success: true })
  }

  const safeMessage = sanitizeClientDiagnosticText(payload.message)
  const safeStack = payload.stack ? sanitizeClientDiagnosticText(payload.stack) : undefined

  // 只记白名单字段。客户端上传的 requestId/projectId 未经校验，
  // 只进入 details，不写入日志上下文的权威 requestId/projectId 列。
  const logger = createScopedLogger({
    module: 'client',
    ...(userId ? { userId } : {}),
  })
  logger.error({
    action: 'client.error',
    message: safeMessage,
    details: {
      kind: payload.kind,
      url: sanitizeClientUrl(payload.url),
      userAgent: payload.userAgent,
      ...(payload.requestId ? { clientRequestId: payload.requestId } : {}),
      ...(payload.projectId ? { clientProjectId: payload.projectId } : {}),
    },
    error: {
      name: `client.${payload.kind}`,
      message: safeMessage,
      ...(safeStack ? { stack: safeStack } : {}),
    },
  })

  return NextResponse.json({ success: true })
})
