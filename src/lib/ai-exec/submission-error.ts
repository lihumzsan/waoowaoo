import { AppError } from '@/lib/errors/app-error'
import { EXTERNAL_OPERATION } from '@/lib/external-operation/registry'
import type { FailureContext, FailureDetails } from '@/lib/errors/failure'
import type { UnifiedErrorCode } from '@/lib/errors/codes'

export type ProviderSubmissionDisposition =
  | 'pre_accept_rejected'
  | 'rejected'

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
      readonly context?: FailureContext
      readonly cause?: unknown
    },
  ) {
    super(code, message, {
      provider: options.provider,
      details: options.details,
      context: options.context ?? {
        system: 'provider',
        provider: options.provider,
        phase: 'submit',
      },
      cause: options.cause,
      operation: EXTERNAL_OPERATION.PROVIDER_SUBMIT,
    })
    this.name = 'ProviderSubmissionError'
    this.disposition = options.disposition
    this.externalId = options.externalId?.trim() || null
  }
}
