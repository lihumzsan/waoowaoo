export class ProviderTerminalFailureError extends Error {
  readonly externalId: string

  constructor(externalId: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ProviderTerminalFailureError'
    this.externalId = externalId
  }
}

export class ProviderPermanentFailureError extends Error {
  readonly externalId: string

  constructor(externalId: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ProviderPermanentFailureError'
    this.externalId = externalId
  }
}
