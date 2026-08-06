import { AppError } from '@/lib/errors/app-error'
import type { FailureDetails, FailureOrigin } from '@/lib/errors/failure'
import type { UnifiedErrorCode } from '@/lib/errors/codes'

export type ProviderSubmissionDisposition =
  | 'pre_accept_rejected'
  | 'rejected'
  | 'retryable_rejected'

/**
 * Provider-owned proof of what happened to a submission request. The durable
 * fence consumes this explicit disposition and never guesses from HTTP status
 * or generic retryability.
 */
export class ProviderSubmissionError extends AppError {
  readonly disposition: ProviderSubmissionDisposition
  readonly externalId: string | null

  constructor(
    code: UnifiedErrorCode,
    message: string,
    options: {
      readonly disposition: ProviderSubmissionDisposition
      readonly provider: string
      readonly externalId?: string | null
      readonly details?: FailureDetails
      readonly origin?: FailureOrigin
      readonly cause?: unknown
    },
  ) {
    super(code, message, {
      provider: options.provider,
      details: options.details,
      origin: options.origin ?? {
        system: 'provider',
        provider: options.provider,
        phase: 'submit',
      },
      cause: options.cause,
    })
    this.name = 'ProviderSubmissionError'
    this.disposition = options.disposition
    this.externalId = options.externalId?.trim() || null
  }
}
