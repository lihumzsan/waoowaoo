import { createHmac, randomInt, randomUUID } from 'node:crypto'
import { ApiError } from '@/lib/api-errors'
import { createAuthUser } from '@/lib/auth/account-onboarding'
import {
  AliyunSmsConfigurationError,
  AliyunSmsDestinationUnavailableError,
  AliyunSmsRejectedError,
  sendAliyunVerificationSms,
  type AliyunSmsSendResult,
} from '@/lib/auth/aliyun-sms'
import { PHONE_AUTH_RESULT_CODES, type PhoneAuthResultCode } from '@/lib/auth/phone-auth-contract'
import { maskPhoneNumber, normalizePhoneNumber } from '@/lib/auth/phone-number'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { getDeploymentFeatures } from '@/lib/deployment/features'
import { logAuthAction } from '@/lib/logging/semantic'
import { createScopedLogger } from '@/lib/logging/core'
import { prisma } from '@/lib/prisma'
import { getPrismaErrorCode } from '@/lib/prisma-error'
import { redis } from '@/lib/redis'

const PHONE_CODE_TTL_SECONDS = 5 * 60
const PHONE_SEND_COOLDOWN_SECONDS = 60
const PHONE_DAILY_SEND_LIMIT = 10
const PHONE_CODE_MAX_ATTEMPTS = 5

const smsLogger = createScopedLogger({
  module: 'auth',
  provider: 'aliyun-sms',
})

const RESERVE_CHALLENGE_SCRIPT = `
local dailyCount = tonumber(redis.call('GET', KEYS[3]) or '0')
if dailyCount >= tonumber(ARGV[4]) then
  return {-1, redis.call('TTL', KEYS[3])}
end

if redis.call('EXISTS', KEYS[2]) == 1 then
  return {0, redis.call('TTL', KEYS[2])}
end

redis.call('DEL', KEYS[1])
redis.call('HSET', KEYS[1], 'id', ARGV[1], 'codeHash', ARGV[2], 'attempts', '0')
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
redis.call('SET', KEYS[2], ARGV[1], 'EX', tonumber(ARGV[5]))
local nextDailyCount = redis.call('INCR', KEYS[3])
if nextDailyCount == 1 then
  redis.call('EXPIRE', KEYS[3], 86400)
end
return {1, 0}
`

const COMPENSATE_REJECTED_CHALLENGE_SCRIPT = `
if redis.call('HGET', KEYS[1], 'id') ~= ARGV[1] then
  return 0
end
redis.call('DEL', KEYS[1])
if redis.call('GET', KEYS[2]) == ARGV[1] then
  redis.call('DEL', KEYS[2])
end
local dailyCount = tonumber(redis.call('GET', KEYS[3]) or '0')
if dailyCount > 0 then
  redis.call('DECR', KEYS[3])
end
return 1
`

const CONSUME_CHALLENGE_SCRIPT = `
local expectedHash = redis.call('HGET', KEYS[1], 'codeHash')
if not expectedHash then
  return 0
end
if expectedHash == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
local attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
if attempts >= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
end
return -1
`

export interface PhoneAuthUser {
  id: string
  name: string
}

export class PhoneVerificationError extends Error {
  readonly code: PhoneAuthResultCode
  readonly retryAfterSeconds: number | null
  override readonly cause?: unknown

  constructor(
    code: PhoneAuthResultCode,
    retryAfterSeconds: number | null = null,
    cause?: unknown,
  ) {
    super(code, { cause })
    this.name = 'PhoneVerificationError'
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
    this.cause = cause
  }
}

export function requirePhoneAuthEnabled(): void {
  const features = getDeploymentFeatures(getDeploymentConfig())
  if (!features.enablePhoneAuth) {
    throw new PhoneVerificationError(PHONE_AUTH_RESULT_CODES.featureDisabled)
  }
}

function readHashSecret(): string {
  const value = process.env.NEXTAUTH_SECRET
  if (typeof value !== 'string' || value.length < 24) {
    throw new PhoneVerificationError(PHONE_AUTH_RESULT_CODES.providerUnavailable)
  }
  return value
}

function digest(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex')
}

function phoneRedisKeys(phoneNumber: string, secret: string) {
  const identityDigest = digest(secret, `phone:${phoneNumber}`)
  const utcDate = new Date().toISOString().slice(0, 10)
  return {
    challenge: `auth:phone:challenge:${identityDigest}`,
    cooldown: `auth:phone:cooldown:${identityDigest}`,
    daily: `auth:phone:daily:${utcDate}:${identityDigest}`,
  }
}

function readRedisTuple(value: unknown): readonly [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const status = Number(value[0])
  const retryAfterSeconds = Number(value[1])
  if (!Number.isFinite(status) || !Number.isFinite(retryAfterSeconds)) return null
  return [status, Math.max(0, Math.ceil(retryAfterSeconds))]
}

async function reservePhoneChallenge(input: {
  phoneNumber: string
  code: string
  challengeId: string
}): Promise<{ keys: ReturnType<typeof phoneRedisKeys> }> {
  const secret = readHashSecret()
  const keys = phoneRedisKeys(input.phoneNumber, secret)
  const codeHash = digest(secret, `code:${input.phoneNumber}:${input.code}`)

  let rawResult: unknown
  try {
    rawResult = await redis.eval(
      RESERVE_CHALLENGE_SCRIPT,
      3,
      keys.challenge,
      keys.cooldown,
      keys.daily,
      input.challengeId,
      codeHash,
      PHONE_CODE_TTL_SECONDS,
      PHONE_DAILY_SEND_LIMIT,
      PHONE_SEND_COOLDOWN_SECONDS,
    )
  } catch {
    throw new PhoneVerificationError(PHONE_AUTH_RESULT_CODES.providerUnavailable)
  }

  const result = readRedisTuple(rawResult)
  if (!result) {
    throw new PhoneVerificationError(PHONE_AUTH_RESULT_CODES.providerUnavailable)
  }
  if (result[0] !== 1) {
    throw new PhoneVerificationError(
      PHONE_AUTH_RESULT_CODES.sendRateLimited,
      result[1] || PHONE_SEND_COOLDOWN_SECONDS,
    )
  }

  return { keys }
}

async function compensateRejectedChallenge(
  keys: ReturnType<typeof phoneRedisKeys>,
  challengeId: string,
): Promise<void> {
  try {
    await redis.eval(
      COMPENSATE_REJECTED_CHALLENGE_SCRIPT,
      3,
      keys.challenge,
      keys.cooldown,
      keys.daily,
      challengeId,
    )
  } catch {
    // The challenge remains fail-closed and expires automatically.
  }
}

async function consumePhoneChallenge(phoneNumber: string, code: string): Promise<boolean> {
  const secret = readHashSecret()
  const keys = phoneRedisKeys(phoneNumber, secret)
  const codeHash = digest(secret, `code:${phoneNumber}:${code}`)

  try {
    const result = await redis.eval(
      CONSUME_CHALLENGE_SCRIPT,
      1,
      keys.challenge,
      codeHash,
      PHONE_CODE_MAX_ATTEMPTS,
    )
    return Number(result) === 1
  } catch {
    return false
  }
}

export async function sendPhoneVerificationCode(rawPhoneNumber: unknown): Promise<{
  phoneNumber: string
  retryAfterSeconds: number
}> {
  requirePhoneAuthEnabled()
  const phoneNumber = normalizePhoneNumber(rawPhoneNumber)
  if (!phoneNumber) {
    throw new PhoneVerificationError(PHONE_AUTH_RESULT_CODES.invalidPhone)
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const challengeId = randomUUID()
  const { keys } = await reservePhoneChallenge({
    phoneNumber,
    code,
    challengeId,
  })

  let sendResult: AliyunSmsSendResult
  try {
    sendResult = await sendAliyunVerificationSms({
      phoneNumber,
      code,
      challengeId,
    })
  } catch (error) {
    if (error instanceof AliyunSmsDestinationUnavailableError) {
      await compensateRejectedChallenge(keys, challengeId)
      logAuthAction(
        'LOGIN',
        'SMS destination unavailable',
        {
          success: false,
          provider: 'aliyun-sms',
          destinationId: error.destinationId,
          reason: error.reason,
        },
        undefined,
        maskPhoneNumber(phoneNumber),
      )
      throw new PhoneVerificationError(
        PHONE_AUTH_RESULT_CODES.destinationUnavailable,
        null,
        error,
      )
    }
    if (error instanceof AliyunSmsConfigurationError) {
      await compensateRejectedChallenge(keys, challengeId)
    }
    if (error instanceof AliyunSmsRejectedError) {
      await compensateRejectedChallenge(keys, challengeId)
      logAuthAction(
        'LOGIN',
        'SMS provider rejected',
        {
          success: false,
          provider: 'aliyun-sms',
          providerCode: error.providerCode,
          requestId: error.requestId,
        },
        undefined,
        maskPhoneNumber(phoneNumber),
      )
      throw new PhoneVerificationError(PHONE_AUTH_RESULT_CODES.providerRejected, null, error)
    }

    logAuthAction(
      'LOGIN',
      'SMS provider unavailable',
      { success: false, provider: 'aliyun-sms' },
      undefined,
      maskPhoneNumber(phoneNumber),
    )
    throw new PhoneVerificationError(PHONE_AUTH_RESULT_CODES.providerUnavailable, null, error)
  }

  smsLogger.event({
    level: 'INFO',
    audit: true,
    action: 'LOGIN',
    message: 'SMS verification code sent',
    providerRequestId: sendResult.bizId ?? sendResult.requestId ?? undefined,
    details: {
      success: true,
      username: maskPhoneNumber(phoneNumber),
    },
  })
  return {
    phoneNumber,
    retryAfterSeconds: PHONE_SEND_COOLDOWN_SECONDS,
  }
}

async function readPhoneUser(phoneNumber: string): Promise<PhoneAuthUser | null> {
  const account = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: 'phone',
        providerAccountId: phoneNumber,
      },
    },
    select: {
      user: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  })
  return account?.user ?? null
}

export async function authorizePhoneIdentity(input: {
  phoneNumber: unknown
  code: unknown
}): Promise<PhoneAuthUser | null> {
  requirePhoneAuthEnabled()
  const phoneNumber = normalizePhoneNumber(input.phoneNumber)
  const code = typeof input.code === 'string' ? input.code.trim() : ''
  if (!phoneNumber || !/^\d{6}$/.test(code)) return null

  const verified = await consumePhoneChallenge(phoneNumber, code)
  if (!verified) {
    logAuthAction(
      'LOGIN',
      'Invalid verification code',
      { success: false, provider: 'phone' },
      undefined,
      maskPhoneNumber(phoneNumber),
    )
    return null
  }

  const existingUser = await readPhoneUser(phoneNumber)
  if (existingUser) {
    logAuthAction(
      'LOGIN',
      'Phone login succeeded',
      { success: true, provider: 'phone' },
      existingUser.id,
      maskPhoneNumber(phoneNumber),
    )
    return existingUser
  }

  try {
    const user = await prisma.$transaction(async (tx) => (
      await createAuthUser(tx, {
        name: phoneNumber,
        account: {
          type: 'credentials',
          provider: 'phone',
          providerAccountId: phoneNumber,
        },
      })
    ))
    logAuthAction(
      'REGISTER',
      'Phone registration succeeded',
      { success: true, provider: 'phone' },
      user.id,
      maskPhoneNumber(phoneNumber),
    )
    return {
      id: user.id,
      name: user.name,
    }
  } catch (error) {
    if (getPrismaErrorCode(error) !== 'P2002') throw error
    const concurrentUser = await readPhoneUser(phoneNumber)
    if (!concurrentUser) {
      throw new ApiError('CONFLICT', {
        code: 'PHONE_AUTH_IDENTITY_CONFLICT',
        message: 'PHONE_AUTH_IDENTITY_CONFLICT',
      }, { cause: error })
    }
    return concurrentUser
  }
}
