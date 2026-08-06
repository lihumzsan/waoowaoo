import {
  BillingOperationError,
  InsufficientBalanceError,
  type BillingOperationErrorCode,
} from '@/lib/billing/errors'
import {
  getPrismaErrorCode,
  isLikelyPrismaDisconnectError,
  isPrismaRetryableCode,
} from '@/lib/prisma-error'
import {
  DEFAULT_ERROR_CODE,
  resolveUnifiedErrorCode,
  type UnifiedErrorCode,
} from './codes'
import {
  createFailureRecord,
  parseFailureRecord,
  type FailureDetails,
  type FailureOrigin,
  type FailureRecord,
} from './failure'

export type NormalizeOptions = {
  fallbackCode?: UnifiedErrorCode
  details?: Record<string, unknown> | null
  origin?: FailureOrigin
}

type ErrorLike = {
  code?: unknown
  status?: unknown
  statusCode?: unknown
  message?: unknown
  details?: unknown
  provider?: unknown
  failure?: unknown
  cause?: unknown
}

function findCarriedFailure(value: unknown): FailureRecord | null {
  let current: unknown = value
  const seen = new Set<unknown>()
  for (let depth = 0; depth < 12; depth += 1) {
    const direct = parseFailureRecord(current)
    if (direct) return direct
    if (!current || typeof current !== 'object' || seen.has(current)) return null
    seen.add(current)
    const record = current as ErrorLike
    const carried = parseFailureRecord(record.failure)
    if (carried) return carried
    current = record.cause
  }
  return null
}

function toMessage(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value instanceof Error && value.message.trim()) return value.message.trim()
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' ? serialized : ''
  } catch {
    return ''
  }
}

/** Bounded internal description for unknown thrown values. */
export function describeUnknownError(value: unknown): string {
  const message = toMessage(value)
  return (message || String(value)).slice(0, 4_000)
}

function readHttpStatus(value: unknown): number | null {
  const raw = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d{3}$/.test(value.trim())
      ? Number.parseInt(value.trim(), 10)
      : Number.NaN
  return Number.isInteger(raw) && raw >= 100 && raw <= 599 ? raw : null
}

function codeFromHttpStatus(status: number): UnifiedErrorCode {
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 409) return 'CONFLICT'
  if (status === 413) return 'PAYLOAD_TOO_LARGE'
  if (status === 422) return 'INVALID_PARAMS'
  if (status === 429) return 'RATE_LIMIT'
  if (status === 504) return 'GENERATION_TIMEOUT'
  if (status >= 500) return 'EXTERNAL_ERROR'
  if (status >= 400) return 'INVALID_PARAMS'
  return DEFAULT_ERROR_CODE
}

function isModelNotOpenCode(code: unknown): boolean {
  if (typeof code !== 'string') return false
  const normalized = code.trim().toUpperCase()
  return normalized === 'MODELNOTOPEN' || normalized === 'MODEL_NOT_OPEN'
}

function failureOrigin(
  provider: string | null,
  explicit: FailureOrigin | undefined,
): FailureOrigin {
  if (explicit) return explicit
  return provider
    ? { system: 'provider', provider }
    : { system: 'application' }
}

function buildFailure(
  code: UnifiedErrorCode,
  message: string,
  details: FailureDetails,
  provider: string | null,
  origin: FailureOrigin | undefined,
): FailureRecord {
  return createFailureRecord(code, message, {
    details,
    origin: failureOrigin(provider, origin),
  })
}

function inferCodeFromPrismaCode(prismaCode: string): UnifiedErrorCode {
  if (prismaCode === 'P2002') return 'CONFLICT'
  if (prismaCode === 'P2001' || prismaCode === 'P2025') return 'NOT_FOUND'
  if (isPrismaRetryableCode(prismaCode)) return 'EXTERNAL_ERROR'
  return 'INTERNAL_ERROR'
}

function codeFromBillingOperation(errorCode: BillingOperationErrorCode): UnifiedErrorCode {
  switch (errorCode) {
    case 'BILLING_ADJUSTMENT_IDEMPOTENCY_CONFLICT':
    case 'BILLING_FREEZE_NOT_PENDING':
    case 'BILLING_FREEZE_OWNERSHIP_MISMATCH':
    case 'BILLING_BALANCE_DEBIT_CONFLICT':
    case 'BILLING_IDEMPOTENT_ALREADY_CONFIRMED':
    case 'BILLING_IDEMPOTENT_IN_PROGRESS':
    case 'BILLING_IDEMPOTENT_ROLLED_BACK':
    case 'BILLING_USAGE_REPLAY_DIVERGED':
      return 'CONFLICT'
    case 'BILLING_INVALID_ADJUSTMENT_AMOUNT':
    case 'BILLING_INVALID_API_TYPE':
    case 'BILLING_INVALID_CHARGED_AMOUNT':
    case 'BILLING_INVALID_DELTA':
    case 'BILLING_INVALID_FREEZE':
    case 'BILLING_INVALID_FREEZE_AMOUNT':
    case 'BILLING_INVALID_PROJECT':
    case 'BILLING_INVALID_USAGE_IDENTITY':
    case 'BILLING_UNKNOWN_VIDEO_CAPABILITY_COMBINATION':
    case 'BILLING_UNKNOWN_VIDEO_RESOLUTION':
      return 'INVALID_PARAMS'
    case 'BILLING_CAPABILITY_PRICE_NOT_FOUND':
    case 'BILLING_BALANCE_NOT_FOUND':
    case 'BILLING_CONFIRM_FAILED':
    case 'BILLING_FREEZE_EXPAND_FAILED':
    case 'BILLING_FREEZE_FAILED':
    case 'BILLING_PRICING_MODEL_AMBIGUOUS':
    case 'BILLING_UNKNOWN_MODEL':
      return 'INTERNAL_ERROR'
    default: {
      const exhaustive: never = errorCode
      return exhaustive
    }
  }
}

export function normalizeAnyError(
  input: unknown,
  options: NormalizeOptions = {},
): FailureRecord {
  const carried = findCarriedFailure(input)
  if (carried) return carried
  const errorLike = (input || {}) as ErrorLike

  const fallbackCode = options.fallbackCode || DEFAULT_ERROR_CODE
  const message = toMessage(errorLike.message ?? input)
  const provider = typeof errorLike.provider === 'string'
    ? errorLike.provider.trim() || null
    : null

  if (input instanceof TypeError) {
    const lower = message.toLowerCase()
    if (lower === 'terminated' || lower.includes('aborted') || lower.includes('socket hang up')) {
      return buildFailure(
        'NETWORK_ERROR',
        message || 'Network request terminated',
        options.details ?? null,
        provider,
        options.origin,
      )
    }
  }

  const prismaCode = getPrismaErrorCode(input)
  if (prismaCode) {
    return buildFailure(
      inferCodeFromPrismaCode(prismaCode),
      message || `Database request failed (${prismaCode})`,
      { prismaCode, ...(options.details || {}) },
      provider,
      options.origin,
    )
  }

  if (isLikelyPrismaDisconnectError(input)) {
    return buildFailure(
      'EXTERNAL_ERROR',
      message || 'Database connection unavailable',
      options.details ?? null,
      provider,
      options.origin,
    )
  }

  if (input instanceof InsufficientBalanceError) {
    return buildFailure(
      'INSUFFICIENT_BALANCE',
      message || input.message,
      {
        required: input.required,
        available: input.available,
        ...(options.details || {}),
      },
      null,
      options.origin,
    )
  }

  if (input instanceof BillingOperationError) {
    return buildFailure(
      codeFromBillingOperation(input.code),
      message || input.message,
      options.details ?? null,
      null,
      options.origin,
    )
  }

  const resolvedCode = resolveUnifiedErrorCode(errorLike.code)
  if (resolvedCode) {
    return buildFailure(
      resolvedCode,
      message,
      {
        ...(errorLike.details && typeof errorLike.details === 'object' && !Array.isArray(errorLike.details)
          ? errorLike.details as Record<string, unknown>
          : {}),
        ...(options.details || {}),
      },
      provider,
      options.origin,
    )
  }

  if (isModelNotOpenCode(errorLike.code)) {
    return buildFailure(
      'MODEL_NOT_OPEN',
      message,
      options.details ?? null,
      provider,
      options.origin,
    )
  }

  const httpStatus = readHttpStatus(errorLike.status)
    ?? readHttpStatus(errorLike.statusCode)
    ?? readHttpStatus(errorLike.code)
  if (httpStatus !== null) {
    return buildFailure(
      codeFromHttpStatus(httpStatus),
      message,
      options.details ?? null,
      provider,
      options.origin,
    )
  }

  return buildFailure(
    fallbackCode,
    message,
    options.details ?? null,
    provider,
    options.origin,
  )
}
