import {
  BillingOperationError,
  InsufficientBalanceError,
  type BillingOperationErrorCode,
} from '@/lib/billing/errors'
import type { ExternalOperationId } from '@/lib/external-operation/registry'
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
  augmentFailureRecord,
  createFailureRecord,
  parseFailureRecord,
  type FailureContext,
  type FailureRecord,
} from './failure'

export type NormalizeOptions = {
  readonly fallbackCode?: UnifiedErrorCode
  readonly details?: Record<string, unknown> | null
  readonly context?: FailureContext
  readonly operation?: ExternalOperationId
  readonly attempts?: number
}

type ErrorLike = {
  readonly code?: unknown
  readonly status?: unknown
  readonly statusCode?: unknown
  readonly message?: unknown
  readonly details?: unknown
  readonly provider?: unknown
  readonly failure?: unknown
  readonly cause?: unknown
}

export function findCarriedFailureRecord(value: unknown): FailureRecord | null {
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
  const carried = findCarriedFailureRecord(value)
  if (carried) return carried.native.message
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

function inferInterpretation(input: unknown, fallbackCode: UnifiedErrorCode): UnifiedErrorCode {
  const errorLike = (input || {}) as ErrorLike
  const message = toMessage(errorLike.message ?? input)
  if (input instanceof TypeError) {
    const lower = message.toLowerCase()
    if (lower === 'terminated' || lower.includes('aborted') || lower.includes('socket hang up')) {
      return 'NETWORK_ERROR'
    }
  }
  const prismaCode = getPrismaErrorCode(input)
  if (prismaCode) return inferCodeFromPrismaCode(prismaCode)
  if (isLikelyPrismaDisconnectError(input)) return 'EXTERNAL_ERROR'
  if (input instanceof InsufficientBalanceError) return 'INSUFFICIENT_BALANCE'
  if (input instanceof BillingOperationError) return codeFromBillingOperation(input.code)
  const resolvedCode = resolveUnifiedErrorCode(errorLike.code)
  if (resolvedCode) return resolvedCode
  if (isModelNotOpenCode(errorLike.code)) return 'MODEL_NOT_OPEN'
  const httpStatus = readHttpStatus(errorLike.status)
    ?? readHttpStatus(errorLike.statusCode)
    ?? readHttpStatus(errorLike.code)
  return httpStatus === null ? fallbackCode : codeFromHttpStatus(httpStatus)
}

function inferredDetails(input: unknown): Record<string, unknown> | null {
  const errorLike = (input || {}) as ErrorLike
  const details = errorLike.details && typeof errorLike.details === 'object' && !Array.isArray(errorLike.details)
    ? errorLike.details as Record<string, unknown>
    : {}
  const prismaCode = getPrismaErrorCode(input)
  if (input instanceof InsufficientBalanceError) {
    return { ...details, required: input.required, available: input.available }
  }
  return prismaCode ? { ...details, prismaCode } : Object.keys(details).length > 0 ? details : null
}

export function normalizeAnyError(
  input: unknown,
  options: NormalizeOptions = {},
): FailureRecord {
  const carried = findCarriedFailureRecord(input)
  if (carried) {
    return augmentFailureRecord(carried, {
      details: options.details,
      context: options.context,
      operation: options.operation,
      attempts: options.attempts,
    })
  }
  const errorLike = (input || {}) as ErrorLike
  const provider = typeof errorLike.provider === 'string'
    ? errorLike.provider.trim() || null
    : null
  const context = options.context ?? (provider
    ? { system: 'provider' as const, provider }
    : { system: 'application' as const })
  const fallbackCode = options.fallbackCode ?? DEFAULT_ERROR_CODE
  const code = inferInterpretation(input, fallbackCode)
  const message = toMessage(errorLike.message ?? input) || getErrorSpecMessage(code)
  return createFailureRecord(code, message, {
    cause: input,
    details: {
      ...(inferredDetails(input) ?? {}),
      ...(options.details ?? {}),
    },
    context,
    operation: options.operation,
    attempts: options.attempts,
  })
}

function getErrorSpecMessage(code: UnifiedErrorCode): string {
  // Kept local to avoid treating a product copy string as native evidence when
  // the thrown value already supplied a diagnostic message.
  return code === 'INTERNAL_ERROR' ? 'Unexpected internal failure' : code
}

class FailureCarrierError extends Error {
  readonly failure: FailureRecord
  readonly cause: unknown

  constructor(failure: FailureRecord, cause: unknown) {
    super(failure.native.message)
    this.name = 'FailureCarrierError'
    this.failure = failure
    this.cause = cause
  }
}

/** Preserve the original error class whenever possible while carrying v2. */
export function attachFailureToThrown(input: unknown, failure: FailureRecord): unknown {
  if (input && typeof input === 'object' && Object.isExtensible(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, 'failure')
    if (!descriptor || descriptor.writable || descriptor.set || descriptor.configurable) {
      Object.defineProperty(input, 'failure', {
        configurable: true,
        enumerable: false,
        value: failure,
        writable: true,
      })
      return input
    }
  }
  return new FailureCarrierError(failure, input)
}
