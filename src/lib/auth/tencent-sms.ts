import { sms } from 'tencentcloud-sdk-nodejs-sms'
import { resolveSmsDestinationFromPhoneNumber } from '@/lib/auth/phone-number'
import type { SmsDestination, SmsDestinationId } from '@/lib/auth/sms-destinations'

export interface TencentSmsConfig {
  secretId: string
  secretKey: string
  region: string
  sdkAppId: string
  domesticSignName: string
  domesticTemplateId: string
  internationalTemplateId: string
}

export interface TencentSmsSendResult {
  requestId: string | null
}

export class TencentSmsRejectedError extends Error {
  readonly providerCode: string
  readonly requestId: string | null

  constructor(providerCode: string, requestId: string | null) {
    super('TENCENT_SMS_SEND_REJECTED')
    this.name = 'TencentSmsRejectedError'
    this.providerCode = providerCode
    this.requestId = requestId
  }
}

export class TencentSmsConfigurationError extends Error {
  constructor(name: string) {
    super(`${name}_MISSING`)
    this.name = 'TencentSmsConfigurationError'
  }
}

export class TencentSmsDestinationUnavailableError extends Error {
  readonly destinationId: SmsDestinationId | null
  readonly reason: 'DESTINATION_NOT_ENABLED' | 'SENDER_ID_MISSING'

  constructor(
    destinationId: SmsDestinationId | null,
    reason: 'DESTINATION_NOT_ENABLED' | 'SENDER_ID_MISSING',
  ) {
    super('TENCENT_SMS_DESTINATION_UNAVAILABLE')
    this.name = 'TencentSmsDestinationUnavailableError'
    this.destinationId = destinationId
    this.reason = reason
  }
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]
  if (typeof value !== 'string' || !value.trim()) {
    throw new TencentSmsConfigurationError(name)
  }
  return value.trim()
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name]
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : undefined
}

export function readTencentSmsConfig(): TencentSmsConfig {
  return {
    secretId: readRequiredEnv('TENCENTCLOUD_SECRET_ID'),
    secretKey: readRequiredEnv('TENCENTCLOUD_SECRET_KEY'),
    region: readRequiredEnv('TENCENTCLOUD_SMS_REGION'),
    sdkAppId: readRequiredEnv('TENCENTCLOUD_SMS_SDK_APP_ID'),
    domesticSignName: readRequiredEnv('TENCENTCLOUD_SMS_DOMESTIC_SIGN_NAME'),
    domesticTemplateId: readRequiredEnv('TENCENTCLOUD_SMS_DOMESTIC_TEMPLATE_ID'),
    internationalTemplateId: readRequiredEnv('TENCENTCLOUD_SMS_INTERNATIONAL_TEMPLATE_ID'),
  }
}

function resolveSenderId(destination: SmsDestination): string | undefined {
  if (destination.channel === 'domestic') return undefined
  const senderId = readOptionalEnv(`TENCENTCLOUD_SMS_SENDER_ID_${destination.id}`)
  if (destination.senderIdPolicy === 'dedicated-required' && !senderId) {
    throw new TencentSmsDestinationUnavailableError(
      destination.id,
      'SENDER_ID_MISSING',
    )
  }
  return senderId
}

export async function sendTencentVerificationSms(input: {
  phoneNumber: string
  code: string
  challengeId: string
}): Promise<TencentSmsSendResult> {
  const destination = resolveSmsDestinationFromPhoneNumber(input.phoneNumber)
  if (!destination) {
    throw new TencentSmsDestinationUnavailableError(
      null,
      'DESTINATION_NOT_ENABLED',
    )
  }
  const config = readTencentSmsConfig()
  const senderId = resolveSenderId(destination)
  const SmsClient = sms.v20210111.Client
  const client = new SmsClient({
    credential: {
      secretId: config.secretId,
      secretKey: config.secretKey,
    },
    region: config.region,
    profile: {
      signMethod: 'TC3-HMAC-SHA256',
      httpProfile: {
        reqMethod: 'POST',
        reqTimeout: 10,
        endpoint: 'sms.tencentcloudapi.com',
      },
    },
  })

  const response = await client.SendSms({
    PhoneNumberSet: [input.phoneNumber],
    SmsSdkAppId: config.sdkAppId,
    TemplateId: destination.channel === 'domestic'
      ? config.domesticTemplateId
      : config.internationalTemplateId,
    TemplateParamSet: [input.code],
    SessionContext: input.challengeId,
    ...(destination.channel === 'domestic'
      ? { SignName: config.domesticSignName }
      : {}),
    ...(senderId ? { SenderId: senderId } : {}),
  })
  const status = response.SendStatusSet?.[0]
  if (status?.Code !== 'Ok') {
    throw new TencentSmsRejectedError(status?.Code || 'TENCENT_SMS_STATUS_MISSING', response.RequestId ?? null)
  }

  return {
    requestId: response.RequestId ?? null,
  }
}
