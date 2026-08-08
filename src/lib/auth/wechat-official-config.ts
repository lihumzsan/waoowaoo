import { getDeploymentConfig } from '@/lib/deployment/config'
import { getDeploymentFeatures } from '@/lib/deployment/features'

export interface WechatOfficialConfig {
  appId: string
  appSecret: string
  token: string
  encodingAesKey: string
}

export const WECHAT_OFFICIAL_RESULT_CODES = {
  featureDisabled: 'WECHAT_OFFICIAL_FEATURE_DISABLED',
  configurationUnavailable: 'WECHAT_OFFICIAL_CONFIGURATION_UNAVAILABLE',
  providerUnavailable: 'WECHAT_OFFICIAL_PROVIDER_UNAVAILABLE',
  attemptInvalid: 'WECHAT_OFFICIAL_ATTEMPT_INVALID',
  attemptExpired: 'WECHAT_OFFICIAL_ATTEMPT_EXPIRED',
  identityConflict: 'WECHAT_OFFICIAL_IDENTITY_CONFLICT',
  callbackInvalid: 'WECHAT_OFFICIAL_CALLBACK_INVALID',
} as const

export type WechatOfficialResultCode =
  typeof WECHAT_OFFICIAL_RESULT_CODES[keyof typeof WECHAT_OFFICIAL_RESULT_CODES]

export class WechatOfficialError extends Error {
  readonly code: WechatOfficialResultCode
  override readonly cause?: unknown

  constructor(code: WechatOfficialResultCode, cause?: unknown) {
    super(code, { cause })
    this.name = 'WechatOfficialError'
    this.code = code
    this.cause = cause
  }
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]
  if (typeof value !== 'string' || !value.trim()) {
    throw new WechatOfficialError(WECHAT_OFFICIAL_RESULT_CODES.configurationUnavailable)
  }
  return value.trim()
}

function validateConfig(config: WechatOfficialConfig): WechatOfficialConfig {
  if (!/^wx[a-zA-Z0-9]{16}$/u.test(config.appId)) {
    throw new WechatOfficialError(WECHAT_OFFICIAL_RESULT_CODES.configurationUnavailable)
  }
  if (
    config.appSecret.length < 24
    || config.token.length < 24
    || config.token.length > 32
  ) {
    throw new WechatOfficialError(WECHAT_OFFICIAL_RESULT_CODES.configurationUnavailable)
  }
  if (!/^[a-zA-Z0-9]{43}$/u.test(config.encodingAesKey)) {
    throw new WechatOfficialError(WECHAT_OFFICIAL_RESULT_CODES.configurationUnavailable)
  }
  const aesKey = Buffer.from(`${config.encodingAesKey}=`, 'base64')
  if (aesKey.length !== 32) {
    throw new WechatOfficialError(WECHAT_OFFICIAL_RESULT_CODES.configurationUnavailable)
  }
  return config
}

export function requireWechatOfficialAuthEnabled(): void {
  const features = getDeploymentFeatures(getDeploymentConfig())
  if (!features.showWechatOfficialAuth) {
    throw new WechatOfficialError(WECHAT_OFFICIAL_RESULT_CODES.featureDisabled)
  }
}

export function readWechatOfficialConfig(): WechatOfficialConfig {
  requireWechatOfficialAuthEnabled()
  return validateConfig({
    appId: readRequiredEnv('WECHAT_OFFICIAL_APP_ID'),
    appSecret: readRequiredEnv('WECHAT_OFFICIAL_APP_SECRET'),
    token: readRequiredEnv('WECHAT_OFFICIAL_TOKEN'),
    encodingAesKey: readRequiredEnv('WECHAT_OFFICIAL_ENCODING_AES_KEY'),
  })
}
