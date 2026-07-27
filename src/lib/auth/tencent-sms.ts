import { sms } from 'tencentcloud-sdk-nodejs-sms'

export interface TencentSmsConfig {
  secretId: string
  secretKey: string
  region: string
  sdkAppId: string
  signName: string
  templateId: string
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

function readRequiredEnv(name: string): string {
  const value = process.env[name]
  if (typeof value !== 'string' || !value.trim()) {
    throw new TencentSmsConfigurationError(name)
  }
  return value.trim()
}

export function readTencentSmsConfig(): TencentSmsConfig {
  return {
    secretId: readRequiredEnv('TENCENTCLOUD_SECRET_ID'),
    secretKey: readRequiredEnv('TENCENTCLOUD_SECRET_KEY'),
    region: readRequiredEnv('TENCENTCLOUD_SMS_REGION'),
    sdkAppId: readRequiredEnv('TENCENTCLOUD_SMS_SDK_APP_ID'),
    signName: readRequiredEnv('TENCENTCLOUD_SMS_SIGN_NAME'),
    templateId: readRequiredEnv('TENCENTCLOUD_SMS_TEMPLATE_ID'),
  }
}

export async function sendTencentVerificationSms(input: {
  phoneNumber: string
  code: string
  challengeId: string
}): Promise<TencentSmsSendResult> {
  const config = readTencentSmsConfig()
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
    SignName: config.signName,
    TemplateId: config.templateId,
    TemplateParamSet: [input.code],
    SessionContext: input.challengeId,
  })
  const status = response.SendStatusSet?.[0]
  if (status?.Code !== 'Ok') {
    throw new TencentSmsRejectedError(status?.Code || 'TENCENT_SMS_STATUS_MISSING', response.RequestId ?? null)
  }

  return {
    requestId: response.RequestId ?? null,
  }
}
