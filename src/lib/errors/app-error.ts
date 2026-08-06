import {
  getErrorSpec,
  type UnifiedErrorCode,
} from './codes'
import {
  normalizeAnyError,
  type NormalizeOptions,
} from './normalize'
import {
  createFailureRecord,
  type FailureDetails,
  type FailureOrigin,
  type FailureRecord,
} from './failure'

export class AppError extends Error {
  readonly failure: FailureRecord
  readonly code: UnifiedErrorCode
  readonly retryable: boolean
  readonly provider: string | null
  readonly details: FailureDetails
  readonly httpStatus: number
  readonly category: string
  readonly userMessageKey: string
  readonly cause?: unknown

  constructor(
    code: UnifiedErrorCode,
    message?: string,
    options?: {
      details?: FailureDetails
      provider?: string | null
      origin?: FailureOrigin
      cause?: unknown
    },
  ) {
    const spec = getErrorSpec(code)
    const origin = options?.origin ?? {
      system: options?.provider ? 'provider' as const : 'application' as const,
      ...(options?.provider ? { provider: options.provider } : {}),
    }
    const failure = createFailureRecord(code, message, {
      details: options?.details,
      origin,
    })
    super(failure.message)
    this.name = 'AppError'
    this.failure = failure
    this.code = failure.code
    this.retryable = spec.retryable
    this.provider = failure.origin.provider ?? null
    this.details = failure.details
    this.httpStatus = spec.httpStatus
    this.category = spec.category
    this.userMessageKey = spec.userMessageKey
    this.cause = options?.cause
  }

  static fromFailure(failure: FailureRecord, cause?: unknown): AppError {
    return new AppError(failure.code, failure.message, {
      details: failure.details,
      origin: failure.origin,
      cause,
    })
  }
}

export function toAppError(input: unknown, options: NormalizeOptions = {}): AppError {
  if (input instanceof AppError) return input
  return AppError.fromFailure(normalizeAnyError(input, options), input)
}
