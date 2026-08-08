import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Locale } from '@/i18n/routing'
import { createWechatTemporaryQr } from '@/lib/auth/wechat-official-client'
import {
  WECHAT_OFFICIAL_RESULT_CODES,
  type WechatOfficialResultCode,
  WechatOfficialError,
} from '@/lib/auth/wechat-official-config'
import { resolveWechatOfficialIdentity } from '@/lib/auth/wechat-official-identity'
import { logAuthAction } from '@/lib/logging/semantic'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'

export type WechatOfficialAttemptMode = 'login' | 'bind'
export type WechatOfficialAttemptState = 'pending' | 'processing' | 'ready' | 'failed'

const ATTEMPT_ID_PATTERN = /^[A-Za-z0-9_-]{24}$/u
const BROWSER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u
const SCENE_PREFIX = 'waoowaoo_'
const ATTEMPT_TTL_SECONDS = 360
const READY_TTL_SECONDS = 300

const CLAIM_ATTEMPT_SCRIPT = `
local state = redis.call('HGET', KEYS[1], 'state')
if not state then return -1 end
local time = redis.call('TIME')
local nowMs = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local expiresAtMs = tonumber(redis.call('HGET', KEYS[1], 'expiresAtMs') or '0')
if state == 'pending' and expiresAtMs <= nowMs then
  redis.call('DEL', KEYS[1])
  return -1
end
local currentOpenId = redis.call('HGET', KEYS[1], 'openId')
if state == 'pending' then
  redis.call('HSET', KEYS[1], 'state', 'processing', 'openId', ARGV[1])
  if redis.call('PTTL', KEYS[1]) < tonumber(ARGV[2]) then
    redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
  end
  return 1
end
if (state == 'processing' or state == 'ready' or state == 'failed') and currentOpenId == ARGV[1] then
  if state == 'ready' then return 3 end
  if state == 'failed' then return 4 end
  return 2
end
return -2
`

const FINALIZE_ATTEMPT_SCRIPT = `
local state = redis.call('HGET', KEYS[1], 'state')
if not state then return -1 end
if redis.call('HGET', KEYS[1], 'openId') ~= ARGV[1] then return -2 end
if state == 'ready' then
  if redis.call('HGET', KEYS[1], 'userId') == ARGV[2] then return 2 end
  return -2
end
if state ~= 'processing' then return -2 end
redis.call('HSET', KEYS[1], 'state', 'ready', 'userId', ARGV[2])
redis.call('HDEL', KEYS[1], 'errorCode')
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return 1
`

const FAIL_ATTEMPT_SCRIPT = `
local state = redis.call('HGET', KEYS[1], 'state')
if not state then return -1 end
if redis.call('HGET', KEYS[1], 'openId') ~= ARGV[1] then return -2 end
if state == 'failed' and redis.call('HGET', KEYS[1], 'errorCode') == ARGV[2] then return 2 end
if state ~= 'processing' then return -2 end
redis.call('HSET', KEYS[1], 'state', 'failed', 'errorCode', ARGV[2])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return 1
`

const COMPENSATE_ATTEMPT_SCRIPT = `
if redis.call('HGET', KEYS[1], 'browserHash') ~= ARGV[1] then return 0 end
if redis.call('HGET', KEYS[1], 'state') ~= 'pending' then return 0 end
return redis.call('DEL', KEYS[1])
`

interface StoredAttempt {
  state: WechatOfficialAttemptState
  mode: WechatOfficialAttemptMode
  locale: Locale
  browserHash: string
  targetUserId: string | null
  openId: string | null
  userId: string | null
  errorCode: WechatOfficialResultCode | null
}

export type WechatOfficialAttemptView =
  | { state: 'pending' }
  | { state: 'ready'; mode: WechatOfficialAttemptMode }
  | { state: 'failed'; code: WechatOfficialResultCode }
  | { state: 'expired'; code: typeof WECHAT_OFFICIAL_RESULT_CODES.attemptExpired }

export interface CreatedWechatOfficialAttempt {
  attemptId: string
  browserToken: string
  qrImageUrl: string
  expiresAt: string
}

export interface ProcessedWechatOfficialScan {
  status: 'ready' | 'failed' | 'expired' | 'ignored'
  locale: Locale
  mode?: WechatOfficialAttemptMode
  code?: WechatOfficialResultCode
}

function readSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET
  if (typeof secret !== 'string' || secret.length < 24) {
    throw new WechatOfficialError(WECHAT_OFFICIAL_RESULT_CODES.configurationUnavailable)
  }
  return secret
}

function digestBrowserToken(browserToken: string): string {
  return createHmac('sha256', readSecret())
    .update(`wechat-official:${browserToken}`)
    .digest('base64url')
}

function attemptKey(attemptId: string): string {
  return `auth:wechat-official:attempt:${attemptId}`
}

export function wechatOfficialAttemptChannel(attemptId: string): string {
  return `auth:wechat-official:attempt-ready:${attemptId}`
}

function attemptIdFromScene(scene: string): string | null {
  if (!scene.startsWith(SCENE_PREFIX)) return null
  const attemptId = scene.slice(SCENE_PREFIX.length)
  return ATTEMPT_ID_PATTERN.test(attemptId) ? attemptId : null
}

function isLocale(value: string | undefined): value is Locale {
  return value === 'zh' || value === 'en'
}

function isMode(value: string | undefined): value is WechatOfficialAttemptMode {
  return value === 'login' || value === 'bind'
}

function isState(value: string | undefined): value is WechatOfficialAttemptState {
  return value === 'pending' || value === 'processing' || value === 'ready' || value === 'failed'
}

function isResultCode(value: string | undefined): value is WechatOfficialResultCode {
  return Object.values(WECHAT_OFFICIAL_RESULT_CODES).includes(value as WechatOfficialResultCode)
}

function parseStoredAttempt(value: Record<string, string>): StoredAttempt | null {
  if (!isState(value.state) || !isMode(value.mode) || !isLocale(value.locale)) return null
  if (!value.browserHash) return null
  return {
    state: value.state,
    mode: value.mode,
    locale: value.locale,
    browserHash: value.browserHash,
    targetUserId: value.targetUserId || null,
    openId: value.openId || null,
    userId: value.userId || null,
    errorCode: isResultCode(value.errorCode) ? value.errorCode : null,
  }
}

function browserHashMatches(storedHash: string, browserToken: string): boolean {
  if (!BROWSER_TOKEN_PATTERN.test(browserToken)) return false
  const actual = Buffer.from(storedHash, 'utf8')
  const expected = Buffer.from(digestBrowserToken(browserToken), 'utf8')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

async function publishAttemptState(attemptId: string): Promise<void> {
  await redis.publish(wechatOfficialAttemptChannel(attemptId), JSON.stringify({ changed: true }))
}

export async function createWechatOfficialAttempt(input: {
  mode: WechatOfficialAttemptMode
  locale: Locale
  targetUserId?: string
}): Promise<CreatedWechatOfficialAttempt> {
  if (input.mode === 'bind' && !input.targetUserId) {
    throw new WechatOfficialError(WECHAT_OFFICIAL_RESULT_CODES.attemptInvalid)
  }
  const attemptId = randomBytes(18).toString('base64url')
  const browserToken = randomBytes(32).toString('base64url')
  const browserHash = digestBrowserToken(browserToken)
  const scene = `${SCENE_PREFIX}${attemptId}`
  const key = attemptKey(attemptId)
  const expiresAtMs = Date.now() + 300_000
  await redis.hset(key, {
    state: 'pending',
    mode: input.mode,
    locale: input.locale,
    browserHash,
    expiresAtMs: String(expiresAtMs),
    ...(input.targetUserId ? { targetUserId: input.targetUserId } : {}),
  })
  await redis.expire(key, ATTEMPT_TTL_SECONDS)

  try {
    const qr = await createWechatTemporaryQr(scene)
    const actualExpiresAtMs = Date.now() + qr.expiresInSeconds * 1000
    await redis.hset(key, 'expiresAtMs', String(actualExpiresAtMs))
    return {
      attemptId,
      browserToken,
      qrImageUrl: qr.imageUrl,
      expiresAt: new Date(actualExpiresAtMs).toISOString(),
    }
  } catch (error) {
    await redis.eval(COMPENSATE_ATTEMPT_SCRIPT, 1, key, browserHash)
    throw error
  }
}

async function readStoredAttempt(attemptId: string): Promise<StoredAttempt | null> {
  if (!ATTEMPT_ID_PATTERN.test(attemptId)) return null
  const raw = await redis.hgetall(attemptKey(attemptId))
  if (Object.keys(raw).length === 0) return null
  return parseStoredAttempt(raw)
}

export async function readWechatOfficialAttemptView(input: {
  attemptId: string
  browserToken: string
}): Promise<WechatOfficialAttemptView> {
  const attempt = await readStoredAttempt(input.attemptId)
  if (!attempt) {
    return { state: 'expired', code: WECHAT_OFFICIAL_RESULT_CODES.attemptExpired }
  }
  if (!browserHashMatches(attempt.browserHash, input.browserToken)) {
    throw new WechatOfficialError(WECHAT_OFFICIAL_RESULT_CODES.attemptInvalid)
  }
  if (attempt.state === 'ready' && attempt.userId) {
    return { state: 'ready', mode: attempt.mode }
  }
  if (attempt.state === 'failed' && attempt.errorCode) {
    return { state: 'failed', code: attempt.errorCode }
  }
  return { state: 'pending' }
}

export async function exchangeWechatOfficialAttempt(input: {
  attemptId: unknown
  browserToken: unknown
}): Promise<{ id: string; name: string } | null> {
  if (typeof input.attemptId !== 'string' || typeof input.browserToken !== 'string') return null
  const attempt = await readStoredAttempt(input.attemptId)
  if (
    !attempt
    || attempt.state !== 'ready'
    || !attempt.userId
    || !browserHashMatches(attempt.browserHash, input.browserToken)
  ) {
    logAuthAction('LOGIN', 'WeChat QR exchange rejected', {
      success: false,
      provider: WECHAT_OFFICIAL_ACCOUNT_PROVIDER_FOR_LOG,
    })
    return null
  }
  const user = await prisma.user.findUnique({
    where: { id: attempt.userId },
    select: { id: true, name: true },
  })
  if (!user) return null
  logAuthAction('LOGIN', 'WeChat QR login succeeded', {
    success: true,
    provider: WECHAT_OFFICIAL_ACCOUNT_PROVIDER_FOR_LOG,
  }, user.id)
  return user
}

const WECHAT_OFFICIAL_ACCOUNT_PROVIDER_FOR_LOG = 'wechat-official'

function normalizeEventScene(event: string, eventKey: string): string | null {
  if (event === 'subscribe' && eventKey.startsWith('qrscene_')) {
    return eventKey.slice('qrscene_'.length)
  }
  if (event === 'SCAN') return eventKey
  return null
}

export async function processWechatOfficialScan(input: {
  event: string
  eventKey: string
  openId: string
}): Promise<ProcessedWechatOfficialScan> {
  const scene = normalizeEventScene(input.event, input.eventKey)
  if (!scene) return { status: 'ignored', locale: 'zh' }
  const attemptId = attemptIdFromScene(scene)
  if (!attemptId) return { status: 'ignored', locale: 'zh' }
  const key = attemptKey(attemptId)
  const claim = Number(await redis.eval(
    CLAIM_ATTEMPT_SCRIPT,
    1,
    key,
    input.openId,
    String(READY_TTL_SECONDS * 1000),
  ))
  if (claim === -1) {
    return {
      status: 'expired',
      locale: 'zh',
      code: WECHAT_OFFICIAL_RESULT_CODES.attemptExpired,
    }
  }
  if (claim === -2) {
    return {
      status: 'failed',
      locale: 'zh',
      code: WECHAT_OFFICIAL_RESULT_CODES.attemptInvalid,
    }
  }

  const attempt = await readStoredAttempt(attemptId)
  if (!attempt || !attempt.openId) {
    throw new WechatOfficialError(WECHAT_OFFICIAL_RESULT_CODES.attemptInvalid)
  }
  if (claim === 4) {
    return {
      status: 'failed',
      locale: attempt.locale,
      mode: attempt.mode,
      code: attempt.errorCode ?? WECHAT_OFFICIAL_RESULT_CODES.attemptInvalid,
    }
  }
  if (claim === 3 && attempt.userId) {
    return { status: 'ready', locale: attempt.locale, mode: attempt.mode }
  }

  try {
    const userId = await resolveWechatOfficialIdentity({
      openId: input.openId,
      mode: attempt.mode,
      targetUserId: attempt.targetUserId,
    })
    const finalized = Number(await redis.eval(
      FINALIZE_ATTEMPT_SCRIPT,
      1,
      key,
      input.openId,
      userId,
      String(READY_TTL_SECONDS),
    ))
    if (finalized !== 1 && finalized !== 2) {
      throw new WechatOfficialError(WECHAT_OFFICIAL_RESULT_CODES.attemptInvalid)
    }
    await publishAttemptState(attemptId)
    return { status: 'ready', locale: attempt.locale, mode: attempt.mode }
  } catch (error) {
    if (
      error instanceof WechatOfficialError
      && error.code === WECHAT_OFFICIAL_RESULT_CODES.identityConflict
    ) {
      await redis.eval(
        FAIL_ATTEMPT_SCRIPT,
        1,
        key,
        input.openId,
        error.code,
        String(READY_TTL_SECONDS),
      )
      await publishAttemptState(attemptId)
      return {
        status: 'failed',
        locale: attempt.locale,
        mode: attempt.mode,
        code: error.code,
      }
    }
    throw error
  }
}
