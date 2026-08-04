export type ProviderPreAcceptReason = 'provider_account_limit'

/**
 * A provider-owned, typed proof that no external generation was accepted.
 * Only this proof may advance a registry-declared provider route set.
 */
export class ProviderPreAcceptRejectedError extends Error {
  readonly disposition = 'pre_accept_rejected'
  readonly externalId = null
  readonly reason: ProviderPreAcceptReason

  constructor(reason: ProviderPreAcceptReason, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ProviderPreAcceptRejectedError'
    this.reason = reason
  }
}
