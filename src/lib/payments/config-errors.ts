const PAYMENT_CONFIG_ERROR_PREFIXES = [
  'PAYMENT_',
  'STRIPE_',
] as const

function readErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null
  const message = error.message.trim()
  return message || null
}

export function isPaymentConfigurationError(error: unknown): boolean {
  const message = readErrorMessage(error)
  if (!message) return false
  return PAYMENT_CONFIG_ERROR_PREFIXES.some((prefix) => message.startsWith(prefix))
}

export function readPaymentConfigurationErrorCode(error: unknown): string {
  const message = readErrorMessage(error)
  return message || 'PAYMENT_CONFIGURATION_INVALID'
}
