import {
  getErrorSpec,
  type UnifiedErrorCode,
} from './codes'
import {
  normalizeAnyError,
  type NormalizeOptions,
} from './normalize'
import type { NormalizedErrorDetails } from './types'

export class AppError extends Error {
  readonly code: UnifiedErrorCode
  readonly retryable: boolean
  readonly provider: string | null
  readonly details: NormalizedErrorDetails
  readonly httpStatus: number
  readonly category: string
  readonly userMessageKey: string
  readonly cause?: unknown

  constructor(
    code: UnifiedErrorCode,
    message?: string,
    options?: {
      details?: NormalizedErrorDetails
      provider?: string | null
      cause?: unknown
    },
  ) {
    const spec = getErrorSpec(code)
    super(message?.trim() || spec.defaultMessage)
    this.name = 'AppError'
    this.code = code
    this.retryable = spec.retryable
    this.provider = options?.provider || null
    this.details = options?.details ?? null
    this.httpStatus = spec.httpStatus
    this.category = spec.category
    this.userMessageKey = spec.userMessageKey
    this.cause = options?.cause
  }
}

export function toAppError(input: unknown, options: NormalizeOptions = {}): AppError {
  if (input instanceof AppError) return input
  const normalized = normalizeAnyError(input, options)
  return new AppError(normalized.code, normalized.message, {
    details: normalized.details,
    provider: normalized.provider || null,
    cause: input,
  })
}
