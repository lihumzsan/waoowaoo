import {
  BillingOperationError,
  InsufficientBalanceError,
  type BillingOperationErrorCode,
} from '@/lib/billing/errors'
import { getPrismaErrorCode, isLikelyPrismaDisconnectError, isPrismaRetryableCode } from '@/lib/prisma-error'
import { DEFAULT_ERROR_CODE, getErrorFailureClass, getErrorSpec, resolveUnifiedErrorCode, type UnifiedErrorCode } from './codes'
import type { ErrorContext, NormalizedError, NormalizedErrorDetails } from './types'

export type NormalizeOptions = {
  context?: ErrorContext
  fallbackCode?: UnifiedErrorCode
  details?: Record<string, unknown> | null
}

type ErrorLike = {
  code?: unknown
  status?: unknown
  statusCode?: unknown
  message?: unknown
  details?: unknown
  provider?: unknown
}

function toMessage(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value instanceof Error && value.message.trim()) return value.message.trim()
  try {
    const serialized = JSON.stringify(value)
    if (typeof serialized === 'string') return serialized
    return ''
  } catch {
    return ''
  }
}

/**
 * Human-readable description of an unknown thrown value. Plain objects are
 * serialized whole (bounded) so provider error payloads thrown as raw JSON
 * survive into logs and persisted error messages instead of "[object Object]".
 */
export function describeUnknownError(value: unknown): string {
  const message = toMessage(value)
  return (message || String(value)).slice(0, 4000)
}

function toLowerMessage(value: unknown): string {
  return toMessage(value).toLowerCase()
}

function containsAny(haystack: string, needles: string[]) {
  for (const needle of needles) {
    if (haystack.includes(needle)) return true
  }
  return false
}

function readHttpStatus(value: unknown): number | null {
  const raw = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d{3}$/.test(value.trim())
      ? Number.parseInt(value.trim(), 10)
      : NaN
  if (!Number.isInteger(raw) || raw < 100 || raw > 599) return null
  return raw
}

function codeFromHttpStatus(status: number): UnifiedErrorCode {
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 409) return 'CONFLICT'
  if (status === 422) return 'INVALID_PARAMS'
  if (status === 429) return 'RATE_LIMIT'
  if (status === 504) return 'GENERATION_TIMEOUT'
  if (status >= 500) return 'EXTERNAL_ERROR'
  if (status >= 400) return 'INVALID_PARAMS'
  return DEFAULT_ERROR_CODE
}

function providerCodeFromHttpStatus(status: number): UnifiedErrorCode {
  if (status === 401 || status === 403) return 'PROVIDER_AUTH_INVALID'
  if (status === 402) return 'PROVIDER_BILLING_REQUIRED'
  return codeFromHttpStatus(status)
}

function isModelNotOpenCode(code: unknown): boolean {
  if (typeof code !== 'string') return false
  const normalized = code.trim().toUpperCase()
  return normalized === 'MODELNOTOPEN' || normalized === 'MODEL_NOT_OPEN'
}

function buildNormalizedError(
  code: UnifiedErrorCode,
  message?: string,
  details: NormalizedErrorDetails = null,
  provider?: string | null,
): NormalizedError {
  const spec = getErrorSpec(code)
  return {
    code,
    message: message?.trim() || spec.defaultMessage,
    httpStatus: spec.httpStatus,
    retryable: spec.retryable,
    category: spec.category,
    failureClass: getErrorFailureClass(code),
    userMessageKey: spec.userMessageKey,
    details,
    provider: provider || null,
  }
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

export function normalizeAnyError(input: unknown, options: NormalizeOptions = {}): NormalizedError {
  const fallbackCode = options.fallbackCode || DEFAULT_ERROR_CODE
  const errorLike = (input || {}) as ErrorLike
  const message = toMessage(errorLike.message ?? input)
  const lowerMessage = toLowerMessage(message)
  const provider = typeof errorLike.provider === 'string' ? errorLike.provider : null

  if (input instanceof TypeError) {
    if (lowerMessage === 'terminated' || containsAny(lowerMessage, ['aborted', 'socket hang up'])) {
      return buildNormalizedError(
        'NETWORK_ERROR',
        message || 'Network request terminated',
        options.details,
        provider,
      )
    }
  }

  const prismaCode = getPrismaErrorCode(input)
  if (prismaCode) {
    return buildNormalizedError(
      inferCodeFromPrismaCode(prismaCode),
      message || `Database request failed (${prismaCode})`,
      {
        prismaCode,
        ...(options.details || {}),
      },
      provider,
    )
  }

  if (isLikelyPrismaDisconnectError(input)) {
    return buildNormalizedError(
      'EXTERNAL_ERROR',
      message || 'Database connection unavailable',
      options.details,
      provider,
    )
  }

  if (input instanceof InsufficientBalanceError) {
    return buildNormalizedError('INSUFFICIENT_BALANCE', message || input.message, {
      required: input.required,
      available: input.available,
      ...(options.details || {}),
    })
  }

  if (input instanceof BillingOperationError) {
    return buildNormalizedError(
      codeFromBillingOperation(input.code),
      message || input.message,
      options.details,
    )
  }

  const resolvedCode = resolveUnifiedErrorCode(errorLike.code)
  if (resolvedCode) {
    return buildNormalizedError(resolvedCode, message, {
      ...(typeof errorLike.details === 'object' && errorLike.details ? (errorLike.details as Record<string, unknown>) : {}),
      ...(options.details || {}),
    }, provider)
  }

  if (isModelNotOpenCode(errorLike.code)) {
    return buildNormalizedError('MODEL_NOT_OPEN', message, options.details, provider)
  }

  const httpStatus = readHttpStatus(errorLike.status)
    ?? readHttpStatus(errorLike.statusCode)
    ?? readHttpStatus(errorLike.code)
  if (httpStatus !== null) {
    const code = options.context === 'worker'
      ? providerCodeFromHttpStatus(httpStatus)
      : codeFromHttpStatus(httpStatus)
    return buildNormalizedError(code, message, options.details, provider)
  }

  return buildNormalizedError(fallbackCode, message || getErrorSpec(fallbackCode).defaultMessage, options.details, provider)
}

export function normalizeTaskError(
  code: string | null | undefined,
  message: string | null | undefined,
  details: Record<string, unknown> | null = null,
): NormalizedError | null {
  if (!code && !message) return null

  const resolvedTaskCode = resolveUnifiedErrorCode(code)
  if (resolvedTaskCode) {
    return buildNormalizedError(resolvedTaskCode, undefined, details)
  }

  return buildNormalizedError(DEFAULT_ERROR_CODE, undefined, details)
}
