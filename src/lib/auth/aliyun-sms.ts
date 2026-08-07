import DysmsapiClient, { SendSmsRequest } from '@alicloud/dysmsapi20170525'
import { Config } from '@alicloud/openapi-client'
import { resolveSmsDestinationFromPhoneNumber } from '@/lib/auth/phone-number'
import type { SmsDestinationId } from '@/lib/auth/sms-destinations'

const ALIYUN_SMS_ENDPOINT = 'dysmsapi.aliyuncs.com'
const ALIYUN_SMS_TIMEOUT_MS = 10_000

export interface AliyunSmsConfig {
  accessKeyId: string
  accessKeySecret: string
  signName: string
  templateCode: string
}

export interface AliyunSmsSendResult {
  requestId: string | null
  bizId: string | null
}

export class AliyunSmsRejectedError extends Error {
  readonly providerCode: string
  readonly requestId: string | null

  constructor(providerCode: string, requestId: string | null) {
    super('ALIYUN_SMS_SEND_REJECTED')
    this.name = 'AliyunSmsRejectedError'
    this.providerCode = providerCode
    this.requestId = requestId
  }
}

export class AliyunSmsConfigurationError extends Error {
  constructor(name: string) {
    super(`${name}_MISSING`)
    this.name = 'AliyunSmsConfigurationError'
  }
}

export class AliyunSmsDestinationUnavailableError extends Error {
  readonly destinationId: SmsDestinationId | null
  readonly reason = 'DESTINATION_NOT_ENABLED'

  constructor(destinationId: SmsDestinationId | null) {
    super('ALIYUN_SMS_DESTINATION_UNAVAILABLE')
    this.name = 'AliyunSmsDestinationUnavailableError'
    this.destinationId = destinationId
  }
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]
  if (typeof value !== 'string' || !value.trim()) {
    throw new AliyunSmsConfigurationError(name)
  }
  return value.trim()
}

export function readAliyunSmsConfig(): AliyunSmsConfig {
  return {
    accessKeyId: readRequiredEnv('ALIBABA_CLOUD_ACCESS_KEY_ID'),
    accessKeySecret: readRequiredEnv('ALIBABA_CLOUD_ACCESS_KEY_SECRET'),
    signName: readRequiredEnv('ALIBABA_CLOUD_SMS_SIGN_NAME'),
    templateCode: readRequiredEnv('ALIBABA_CLOUD_SMS_TEMPLATE_CODE'),
  }
}

export async function sendAliyunVerificationSms(input: {
  phoneNumber: string
  code: string
  challengeId: string
}): Promise<AliyunSmsSendResult> {
  const destination = resolveSmsDestinationFromPhoneNumber(input.phoneNumber)
  if (destination?.id !== 'CN') {
    throw new AliyunSmsDestinationUnavailableError(destination?.id ?? null)
  }

  const config = readAliyunSmsConfig()
  const client = new DysmsapiClient(new Config({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    endpoint: ALIYUN_SMS_ENDPOINT,
    protocol: 'https',
    connectTimeout: ALIYUN_SMS_TIMEOUT_MS,
    readTimeout: ALIYUN_SMS_TIMEOUT_MS,
  }))
  const response = await client.sendSms(new SendSmsRequest({
    phoneNumbers: input.phoneNumber,
    signName: config.signName,
    templateCode: config.templateCode,
    templateParam: JSON.stringify({ code: input.code }),
    outId: input.challengeId,
  }))
  const body = response.body
  if (body?.code !== 'OK') {
    throw new AliyunSmsRejectedError(
      body?.code || 'ALIYUN_SMS_STATUS_MISSING',
      body?.requestId ?? null,
    )
  }

  return {
    requestId: body.requestId ?? null,
    bizId: body.bizId ?? null,
  }
}
