import {
  getErrorSpec,
  type UnifiedErrorCode,
} from './codes'
import {
  normalizeAnyError,
  type NormalizeOptions,
} from './normalize'
import {
  augmentFailureRecord,
  createFailureRecord,
  type FailureContext,
  type FailureDetails,
  type FailureRecord,
} from './failure'

export class AppError extends Error {
  readonly failure: FailureRecord
  readonly code: UnifiedErrorCode
  readonly provider: string | null
  readonly details: FailureDetails
  readonly httpStatus: number
  readonly category: string
  readonly userMessageKey: string
  override readonly cause?: unknown

  constructor(
    code: UnifiedErrorCode,
    message?: string,
    options?: {
      details?: FailureDetails
      provider?: string | null
      context?: FailureContext
      cause?: unknown
      operation?: FailureContext['operation']
    },
  ) {
    const spec = getErrorSpec(code)
    const context = options?.context ?? {
      system: options?.provider ? 'provider' as const : 'application' as const,
      ...(options?.provider ? { provider: options.provider } : {}),
    }
    const suppliedMessage = message ?? spec.defaultMessage
    const failure = options?.cause === undefined
      ? createFailureRecord(code, suppliedMessage, {
          cause: { name: new.target.name, message: suppliedMessage, code },
          details: options?.details,
          context,
          operation: options?.operation,
        })
      : augmentFailureRecord(normalizeAnyError(options.cause), {
          code,
          details: options.details,
          context,
          operation: options.operation,
          message: suppliedMessage,
        })
    super(suppliedMessage)
    this.name = 'AppError'
    this.failure = failure
    this.code = failure.interpretation.code
    this.provider = options?.provider ?? context.provider ?? failure.context.provider ?? null
    this.details = failure.interpretation.details
    this.httpStatus = spec.httpStatus
    this.category = spec.category
    this.userMessageKey = spec.userMessageKey
    this.cause = options?.cause
  }

  static fromFailure(failure: FailureRecord, cause?: unknown): AppError {
    const appError = new AppError(
      failure.interpretation.code,
      failure.native.message,
      {
        details: failure.interpretation.details,
        context: failure.context,
        cause,
      },
    )
    Object.defineProperty(appError, 'failure', {
      configurable: true,
      enumerable: true,
      value: failure,
      writable: false,
    })
    return appError
  }
}

export function toAppError(input: unknown, options: NormalizeOptions = {}): AppError {
  if (input instanceof AppError) return input
  return AppError.fromFailure(normalizeAnyError(input, options), input)
}
