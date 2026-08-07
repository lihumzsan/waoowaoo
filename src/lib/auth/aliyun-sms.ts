import DysmsapiClientExport, { SendSmsRequest } from '@alicloud/dysmsapi20170525'
import { Config } from '@alicloud/openapi-client'
import { resolveSmsDestinationFromPhoneNumber } from '@/lib/auth/phone-number'
import type { SmsDestinationId } from '@/lib/auth/sms-destinations'

const ALIYUN_SMS_ENDPOINT = 'dysmsapi.aliyuncs.com'
const ALIYUN_SMS_TIMEOUT_MS = 10_000

type DysmsapiClientConstructor = typeof DysmsapiClientExport

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolveDysmsapiClientConstructor(): DysmsapiClientConstructor {
  const runtimeExport: unknown = DysmsapiClientExport
  const constructor = typeof runtimeExport === 'function'
    ? runtimeExport
    : isRecord(runtimeExport) && typeof runtimeExport.default === 'function'
      ? runtimeExport.default
      : null
  if (!constructor) {
    throw new AliyunSmsConfigurationError('ALIBABA_CLOUD_SMS_SDK_CLIENT')
  }
  return constructor as DysmsapiClientConstructor
}

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

function createAliyunSmsClient(config: AliyunSmsConfig) {
  const Client = resolveDysmsapiClientConstructor()
  return new Client(new Config({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    endpoint: ALIYUN_SMS_ENDPOINT,
    protocol: 'https',
    connectTimeout: ALIYUN_SMS_TIMEOUT_MS,
    readTimeout: ALIYUN_SMS_TIMEOUT_MS,
  }))
}

export function assertAliyunSmsSdkRuntime(): void {
  createAliyunSmsClient({
    accessKeyId: 'runtime-smoke',
    accessKeySecret: 'runtime-smoke',
    signName: 'runtime-smoke',
    templateCode: 'runtime-smoke',
  })
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
  const client = createAliyunSmsClient(config)
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
