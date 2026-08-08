import type { FailureRecord } from '@/lib/errors/failure'

export class ProviderTaskFailureError extends Error {
  readonly externalId: string
  readonly failure: FailureRecord

  constructor(externalId: string, failure: FailureRecord) {
    super(failure.native.message)
    this.name = 'ProviderTaskFailureError'
    this.externalId = externalId
    this.failure = failure
  }
}
