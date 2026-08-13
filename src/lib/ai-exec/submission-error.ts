import { AppError } from '@/lib/errors/app-error'
import { EXTERNAL_OPERATION } from '@/lib/external-operation/registry'
import type { FailureContext, FailureDetails } from '@/lib/errors/failure'
import type { UnifiedErrorCode } from '@/lib/errors/codes'
import {
  attachFailureToThrown,
  findCarriedFailureRecord,
  normalizeAnyError,
} from '@/lib/errors/normalize'

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
      /** The first native Provider fact or an error carrying its FailureRecord. */
      readonly cause: unknown
    },
  ) {
    if (options.cause === undefined) {
      throw new Error('PROVIDER_SUBMISSION_ERROR_SOURCE_REQUIRED')
    }
    const context = options.context ?? {
      system: 'provider' as const,
      provider: options.provider,
      phase: 'submit',
    }
    const source = findCarriedFailureRecord(options.cause)
      ? options.cause
      : attachFailureToThrown(options.cause, normalizeAnyError(options.cause, {
          fallbackCode: code,
          context,
          operation: EXTERNAL_OPERATION.PROVIDER_SUBMIT,
        }))
    super(code, message, {
      provider: options.provider,
      details: options.details,
      context,
      cause: source,
      operation: EXTERNAL_OPERATION.PROVIDER_SUBMIT,
    })
    this.name = 'ProviderSubmissionError'
    this.disposition = options.disposition
    this.externalId = options.externalId?.trim() || null
  }
}
