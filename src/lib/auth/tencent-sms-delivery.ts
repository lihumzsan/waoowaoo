import { createHash, createHmac } from 'node:crypto'
import { z } from 'zod'
import { createScopedLogger } from '@/lib/logging/core'
import { maskPhoneNumber, normalizePhoneNumber } from '@/lib/auth/phone-number'
import { redis } from '@/lib/redis'

const DELIVERY_CORRELATION_TTL_SECONDS = 7 * 24 * 60 * 60
const DELIVERY_CORRELATION_KEY_PREFIX = 'auth:sms:delivery:'

const logger = createScopedLogger({
  module: 'auth.tencent_sms_delivery',
  provider: 'tencent-sms',
})

const deliveryReportSchema = z.object({
  user_receive_time: z.string().trim().min(1).max(64),
  nationcode: z.string().trim().regex(/^\+?\d{1,4}$/),
  mobile: z.string().trim().min(7).max(32),
  report_status: z.enum(['SUCCESS', 'FAIL']),
  errmsg: z.string().trim().max(128),
  description: z.string().trim().max(512),
  sid: z.string().trim().min(1).max(256),
  ext: z.string().max(512).optional(),
})

const deliveryReportBatchSchema = z.array(deliveryReportSchema).min(1).max(100)

const deliveryCorrelationSchema = z.object({
  phoneDigest: z.string().regex(/^[a-f0-9]{64}$/),
  maskedPhoneNumber: z.string().min(1).max(32),
})

export type TencentSmsDeliveryReport = z.infer<typeof deliveryReportSchema>

export interface TencentSmsDeliveryHandleResult {
  handledCount: number
  ignoredCount: number
  successCount: number
  failureCount: number
}

export class TencentSmsDeliveryPayloadError extends Error {
  constructor() {
    super('TENCENT_SMS_DELIVERY_PAYLOAD_INVALID')
    this.name = 'TencentSmsDeliveryPayloadError'
  }
}

function readHashSecret(): string {
  const value = process.env.NEXTAUTH_SECRET
  if (typeof value !== 'string' || value.length < 24) {
    throw new Error('NEXTAUTH_SECRET_REQUIRED_FOR_SMS_DELIVERY')
  }
  return value
}

function phoneDigest(phoneNumber: string): string {
  return createHmac('sha256', readHashSecret())
    .update(`sms-delivery:${phoneNumber}`)
    .digest('hex')
}

function correlationKey(serialNo: string): string {
  const identity = createHash('sha256').update(serialNo).digest('hex')
  return `${DELIVERY_CORRELATION_KEY_PREFIX}${identity}`
}

function normalizeCallbackPhoneNumber(report: TencentSmsDeliveryReport): string | null {
  const nationCode = report.nationcode.replace(/^\+/, '')
  const mobile = report.mobile.replace(/^\+/, '')
  const e164 = mobile.startsWith(nationCode)
    ? `+${mobile}`
    : `+${nationCode}${mobile}`
  return normalizePhoneNumber(e164)
}

function parseDeliveryCorrelation(rawValue: string): z.infer<typeof deliveryCorrelationSchema> | null {
  try {
    const parsedJson: unknown = JSON.parse(rawValue)
    const result = deliveryCorrelationSchema.safeParse(parsedJson)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function parseTencentSmsDeliveryReports(input: unknown): TencentSmsDeliveryReport[] {
  const result = deliveryReportBatchSchema.safeParse(input)
  if (!result.success) throw new TencentSmsDeliveryPayloadError()
  return result.data
}

export async function rememberTencentSmsDeliveryAttempt(input: {
  serialNo: string | null
  phoneNumber: string
}): Promise<boolean> {
  if (!input.serialNo) {
    logger.error({
      action: 'alert.sms.delivery_correlation_missing',
      message: 'Tencent SMS accepted without a delivery serial number',
      retryable: false,
    })
    return false
  }

  try {
    const correlation = {
      phoneDigest: phoneDigest(input.phoneNumber),
      maskedPhoneNumber: maskPhoneNumber(input.phoneNumber),
    }
    await redis.set(
      correlationKey(input.serialNo),
      JSON.stringify(correlation),
      'EX',
      DELIVERY_CORRELATION_TTL_SECONDS,
    )
    return true
  } catch (error) {
    logger.error({
      action: 'alert.sms.delivery_correlation_failed',
      message: 'Tencent SMS delivery correlation could not be recorded',
      providerRequestId: input.serialNo,
      retryable: true,
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { name: 'UnknownError', message: 'Unknown SMS delivery correlation error' },
    })
    return false
  }
}

export async function handleTencentSmsDeliveryReports(
  reports: readonly TencentSmsDeliveryReport[],
): Promise<TencentSmsDeliveryHandleResult> {
  let handledCount = 0
  let ignoredCount = 0
  let successCount = 0
  let failureCount = 0

  for (const report of reports) {
    const rawCorrelation = await redis.get(correlationKey(report.sid))
    if (!rawCorrelation) {
      ignoredCount += 1
      logger.debug({
        action: 'sms.delivery.unknown',
        message: 'Tencent SMS delivery report has no active correlation',
        providerRequestId: report.sid,
      })
      continue
    }

    const correlation = parseDeliveryCorrelation(rawCorrelation)
    const callbackPhoneNumber = normalizeCallbackPhoneNumber(report)
    if (
      !correlation
      || !callbackPhoneNumber
      || correlation.phoneDigest !== phoneDigest(callbackPhoneNumber)
    ) {
      ignoredCount += 1
      logger.warn({
        action: 'alert.sms.delivery_identity_mismatch',
        message: 'Tencent SMS delivery report did not match its send identity',
        providerRequestId: report.sid,
        retryable: false,
      })
      continue
    }

    handledCount += 1
    const succeeded = report.report_status === 'SUCCESS'
    if (succeeded) successCount += 1
    else failureCount += 1

    logger.event({
      level: succeeded ? 'INFO' : 'WARN',
      action: succeeded ? 'sms.delivery.succeeded' : 'sms.delivery.failed',
      message: succeeded
        ? 'Tencent SMS delivery succeeded'
        : 'Tencent SMS delivery failed',
      providerRequestId: report.sid,
      errorCode: succeeded ? undefined : report.errmsg,
      retryable: false,
      details: {
        reportStatus: report.report_status,
        receivedAt: report.user_receive_time,
        username: correlation.maskedPhoneNumber,
      },
    })
  }

  return {
    handledCount,
    ignoredCount,
    successCount,
    failureCount,
  }
}
