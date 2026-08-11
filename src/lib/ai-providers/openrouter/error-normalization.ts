import {
  BadGatewayResponseError,
  BadRequestResponseError,
  EdgeNetworkTimeoutResponseError,
  ForbiddenResponseError,
  InternalServerResponseError,
  NotFoundResponseError,
  PaymentRequiredResponseError,
  ProviderOverloadedResponseError,
  RequestTimeoutResponseError,
  ServiceUnavailableResponseError,
  TooManyRequestsResponseError,
  UnauthorizedResponseError,
  UnprocessableEntityResponseError,
} from '@openrouter/sdk/models/errors'
import { AppError } from '@/lib/errors/app-error'
import type { UnifiedErrorCode } from '@/lib/errors/codes'
import { augmentFailureRecord } from '@/lib/errors/failure'
import { createAiProviderFailureAdapter } from '@/lib/ai-providers/failure'
import type { AiProviderFailureAdapter } from '@/lib/ai-providers/runtime-types'

const ERROR_FIELD_LIMIT = 1_000

export const OPENROUTER_CONTENT_POLICY_REJECTION_MESSAGE =
  'OpenRouter rejected the request under its content policy'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function limitedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized.slice(0, ERROR_FIELD_LIMIT) : null
}

function boundedJson(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, ERROR_FIELD_LIMIT)
  } catch {
    return ''
  }
}

export function isOpenRouterSensitiveRejection(...values: readonly unknown[]): boolean {
  const text = values.map((value) => (
    typeof value === 'string' ? value : boundedJson(value)
  )).join(' ').toLowerCase()
  return [
    'inputimagesensitivecontentdetected',
    'sensitivecontentdetected',
    'sensitive_content',
    'content_policy_violation',
    'moderation_blocked',
    'safety_blocked',
  ].some((marker) => text.includes(marker))
}

/** Classify only explicit provider machine codes; user-facing prose is never an oracle. */
export function classifyOpenRouterMachineErrorCode(value: unknown): UnifiedErrorCode | null {
  const code = limitedString(value)?.toLowerCase().replace(/[.-]/gu, '_') ?? ''
  if (!code) return null
  if (isOpenRouterSensitiveRejection(code)) return 'SENSITIVE_CONTENT'
  if (['unauthorized', 'forbidden', 'invalid_api_key', 'authentication_error'].includes(code)) {
    return 'PROVIDER_AUTH_INVALID'
  }
  if (['payment_required', 'insufficient_credits', 'insufficient_balance'].includes(code)) {
    return 'PROVIDER_BILLING_REQUIRED'
  }
  if (['rate_limit', 'rate_limit_exceeded', 'too_many_requests'].includes(code)) return 'RATE_LIMIT'
  if (['request_timeout', 'network_error', 'edge_network_timeout'].includes(code)) return 'NETWORK_ERROR'
  if (['context_length_exceeded', 'context_window_exceeded', 'max_tokens_exceeded', 'string_too_long', 'token_limit_exceeded'].includes(code)) {
    return 'CONTEXT_BUDGET_EXCEEDED'
  }
  if (['server_error', 'internal_server_error', 'provider_overloaded', 'service_unavailable'].includes(code)) {
    return 'EXTERNAL_ERROR'
  }
  if (['invalid_request', 'bad_request', 'unprocessable_entity', 'not_found'].includes(code)) {
    return 'PROVIDER_SUBMISSION_REJECTED'
  }
  return null
}

function readMachineTokens(value: unknown): readonly unknown[] {
  const record = asRecord(value)
  if (!record) return []
  const error = asRecord(record.error)
  const metadata = asRecord(error?.metadata) ?? asRecord(record.metadata)
  const envelope = asRecord(record.envelope)
  return [
    record.code,
    record.type,
    record.errorType,
    record.error_type,
    error?.code,
    error?.type,
    error?.error_type,
    metadata?.code,
    metadata?.type,
    metadata?.error_type,
    metadata?.provider_code,
    metadata?.provider_error_code,
    envelope?.code,
    envelope?.type,
    envelope?.errorType,
  ]
}

function classifyOpenRouterFailureSource(value: unknown): UnifiedErrorCode | null {
  let current: unknown = value
  const seen = new Set<unknown>()
  for (let depth = 0; depth < 10; depth += 1) {
    if (!current || typeof current !== 'object' || seen.has(current)) return null
    seen.add(current)
    for (const token of readMachineTokens(current)) {
      const code = classifyOpenRouterMachineErrorCode(token)
      if (code) return code
    }
    current = (current as { readonly cause?: unknown }).cause
  }
  return null
}

const baseOpenRouterFailureAdapter = createAiProviderFailureAdapter('openrouter')

/** The only OpenRouter machine-code interpretation capability. */
export const openRouterFailureAdapter: AiProviderFailureAdapter = {
  providerKey: 'openrouter',
  normalize: (input) => {
    const failure = baseOpenRouterFailureAdapter.normalize(input)
    const code = classifyOpenRouterFailureSource(input.error)
    return code && code !== failure.interpretation.code
      ? augmentFailureRecord(failure, { code })
      : failure
  },
}

type OpenRouterSdkErrorShape = {
  readonly error: {
    readonly code: number
    readonly message: string
    readonly metadata?: unknown
  }
}

function normalizeDetails(error: OpenRouterSdkErrorShape): {
  readonly message: string
  readonly details: Record<string, unknown>
  readonly sensitive: boolean
} {
  const metadata = asRecord(error.error.metadata)
  const providerErrorType = limitedString(metadata?.error_type)
    ?? limitedString(metadata?.type)
    ?? limitedString(metadata?.code)
  return {
    message: error.error.message,
    details: {
      providerCode: error.error.code,
      ...(providerErrorType ? { providerErrorType } : {}),
    },
    sensitive: isOpenRouterSensitiveRejection(providerErrorType),
  }
}

/** The single OpenRouter SDK HTTP-error classifier shared by all media adapters. */
export function throwNormalizedOpenRouterSdkError(error: unknown): never {
  if (error instanceof UnauthorizedResponseError || error instanceof ForbiddenResponseError) {
    const normalized = normalizeDetails(error)
    throw new AppError('PROVIDER_AUTH_INVALID', normalized.message, {
      provider: 'openrouter',
      details: normalized.details,
      cause: error,
    })
  }
  if (error instanceof PaymentRequiredResponseError) {
    const normalized = normalizeDetails(error)
    throw new AppError('PROVIDER_BILLING_REQUIRED', normalized.message, {
      provider: 'openrouter',
      details: normalized.details,
      cause: error,
    })
  }
  if (error instanceof TooManyRequestsResponseError) {
    const normalized = normalizeDetails(error)
    throw new AppError('RATE_LIMIT', normalized.message, {
      provider: 'openrouter',
      details: normalized.details,
      cause: error,
    })
  }
  if (
    error instanceof InternalServerResponseError
    || error instanceof BadGatewayResponseError
    || error instanceof ServiceUnavailableResponseError
    || error instanceof ProviderOverloadedResponseError
  ) {
    const normalized = normalizeDetails(error)
    throw new AppError('EXTERNAL_ERROR', normalized.message, {
      provider: 'openrouter',
      details: normalized.details,
      cause: error,
    })
  }
  if (error instanceof RequestTimeoutResponseError || error instanceof EdgeNetworkTimeoutResponseError) {
    const normalized = normalizeDetails(error)
    throw new AppError('NETWORK_ERROR', normalized.message, {
      provider: 'openrouter',
      details: normalized.details,
      cause: error,
    })
  }
  if (
    error instanceof BadRequestResponseError
    || error instanceof NotFoundResponseError
    || error instanceof UnprocessableEntityResponseError
  ) {
    const normalized = normalizeDetails(error)
    throw new AppError(
      normalized.sensitive ? 'SENSITIVE_CONTENT' : 'PROVIDER_SUBMISSION_REJECTED',
      normalized.sensitive
        ? OPENROUTER_CONTENT_POLICY_REJECTION_MESSAGE
        : normalized.message,
      {
        provider: 'openrouter',
        details: normalized.details,
        cause: error,
      },
    )
  }
  throw error
}
