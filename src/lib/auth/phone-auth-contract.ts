export const PHONE_AUTH_RESULT_CODES = {
  codeSent: 'PHONE_AUTH_CODE_SENT',
  invalidPhone: 'PHONE_AUTH_PHONE_INVALID',
  sendRateLimited: 'PHONE_AUTH_SEND_RATE_LIMITED',
  verificationInvalid: 'PHONE_AUTH_VERIFICATION_INVALID',
  providerUnavailable: 'PHONE_AUTH_PROVIDER_UNAVAILABLE',
  providerRejected: 'PHONE_AUTH_PROVIDER_REJECTED',
  featureDisabled: 'PHONE_AUTH_FEATURE_DISABLED',
  bodyParseFailed: 'PHONE_AUTH_BODY_PARSE_FAILED',
} as const

export type PhoneAuthResultCode =
  (typeof PHONE_AUTH_RESULT_CODES)[keyof typeof PHONE_AUTH_RESULT_CODES]

const PHONE_AUTH_RESULT_CODE_VALUES = new Set<string>(
  Object.values(PHONE_AUTH_RESULT_CODES),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isPhoneAuthResultCode(value: unknown): value is PhoneAuthResultCode {
  return typeof value === 'string' && PHONE_AUTH_RESULT_CODE_VALUES.has(value)
}

export function readPhoneAuthResultCode(payload: unknown): PhoneAuthResultCode | null {
  if (!isRecord(payload)) return null
  if (isPhoneAuthResultCode(payload.code)) return payload.code

  const error = payload.error
  if (!isRecord(error)) return null
  const details = error.details
  if (!isRecord(details)) return null
  return isPhoneAuthResultCode(details.code) ? details.code : null
}
