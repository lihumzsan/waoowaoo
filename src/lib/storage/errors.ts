export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageConfigError'
  }
}

type StorageOperation = 'upload'

type StorageErrorLike = {
  readonly name?: unknown
  readonly code?: unknown
  readonly statusCode?: unknown
  readonly $metadata?: {
    readonly httpStatusCode?: unknown
  }
}

const RETRYABLE_STORAGE_ERROR_IDENTITIES = new Set([
  'UserNetworkTooSlow',
  'RequestTimeout',
  'RequestTimeoutException',
  'TimeoutError',
  'NetworkingError',
  'SlowDown',
  'ServiceUnavailable',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
])

const RETRYABLE_STORAGE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504])

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readHttpStatus(error: StorageErrorLike): number | null {
  const value = error.$metadata?.httpStatusCode ?? error.statusCode
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d{3}$/.test(value.trim())
      ? Number.parseInt(value, 10)
      : Number.NaN
  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 599 ? parsed : null
}

export class StorageOperationError extends Error {
  readonly code = 'NETWORK_ERROR' as const
  readonly details: {
    readonly operation: StorageOperation
    readonly providerCode: string | null
    readonly httpStatus: number | null
  }
  readonly cause: unknown

  constructor(input: {
    readonly operation: StorageOperation
    readonly providerCode: string | null
    readonly httpStatus: number | null
    readonly cause: unknown
  }) {
    super(`Object storage ${input.operation} failed because the external connection was unavailable`)
    this.name = 'StorageOperationError'
    this.details = {
      operation: input.operation,
      providerCode: input.providerCode,
      httpStatus: input.httpStatus,
    }
    this.cause = input.cause
  }
}

/**
 * Convert only explicit transport/throttling failures at the S3 boundary.
 * Authentication, validation and unknown provider failures keep their original
 * identity and therefore cannot be retried by guessing from message text.
 */
export function normalizeS3OperationError(
  error: unknown,
  operation: StorageOperation,
): unknown {
  if (!error || typeof error !== 'object') return error
  const errorLike = error as StorageErrorLike
  const name = readString(errorLike.name)
  const code = readString(errorLike.code)
  const httpStatus = readHttpStatus(errorLike)
  const providerCode = code ?? name
  const retryable = (name !== null && RETRYABLE_STORAGE_ERROR_IDENTITIES.has(name))
    || (code !== null && RETRYABLE_STORAGE_ERROR_IDENTITIES.has(code))
    || (httpStatus !== null && RETRYABLE_STORAGE_HTTP_STATUSES.has(httpStatus))
  if (!retryable) return error
  return new StorageOperationError({
    operation,
    providerCode,
    httpStatus,
    cause: error,
  })
}
