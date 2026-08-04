import type { UnifiedErrorCode } from '@/lib/errors/codes'

export class ProviderTerminalFailureError extends Error {
  readonly externalId: string
  readonly code: UnifiedErrorCode

  constructor(externalId: string, code: UnifiedErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ProviderTerminalFailureError'
    this.externalId = externalId
    this.code = code
  }
}

export class ProviderPermanentFailureError extends Error {
  readonly externalId: string
  readonly code: UnifiedErrorCode

  constructor(externalId: string, code: UnifiedErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ProviderPermanentFailureError'
    this.externalId = externalId
    this.code = code
  }
}
