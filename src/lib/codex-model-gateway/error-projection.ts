import { readResponseBufferWithLimit } from '@/lib/http/body-limits'

const CODEX_PROVIDER_ERROR_MAX_BYTES = 64 * 1024

export type CodexProviderFailureKind =
  | 'billing_required'
  | 'configuration_unavailable'
  | 'context_exceeded'
  | 'policy_rejected'
  | 'rate_limited'
  | 'request_rejected'
  | 'temporarily_unavailable'

export type CodexProviderResponseProjection = {
  readonly response: Response
  readonly failureKind: CodexProviderFailureKind | null
  readonly providerStatus: number
  readonly providerCode: string | null
  readonly providerErrorType: string | null
}

type ProviderErrorMetadata = {
  readonly code: string | null
  readonly type: string | null
  readonly errorType: string | null
  readonly providerCode: string | null
  readonly message: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function projectTransparentProviderResponse(response: Response): Response {
  const headers = new Headers()
  const contentType = response.headers.get('content-type')?.trim()
  const retryAfter = response.headers.get('retry-after')?.trim()
  if (contentType) headers.set('Content-Type', contentType)
  if (retryAfter) headers.set('Retry-After', retryAfter)
  headers.set('Cache-Control', 'no-store')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function boundedProviderErrorToken(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return normalized && normalized.length <= 128 ? normalized : null
}

function boundedProviderErrorMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value
    .trim()
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s]*/gi, '$1?[redacted]')
    .replace(/([?&](?:token|signature|credential|key|secret)=)[^&\s]*/gi, '$1[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]')
    .replace(/\b(api[-_]?key|password|secret|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
  return normalized ? normalized.slice(0, 2_000) : null
}

function readNestedProviderError(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) && isRecord(parsed.error) ? parsed.error : null
  } catch {
    return null
  }
}

async function readProviderErrorMetadata(response: Response): Promise<ProviderErrorMetadata> {
  try {
    const body = await readResponseBufferWithLimit(
      response.clone(),
      CODEX_PROVIDER_ERROR_MAX_BYTES,
      'Codex provider error response',
    )
    const parsed: unknown = JSON.parse(body.toString('utf8'))
    if (!isRecord(parsed) || !isRecord(parsed.error)) {
      return { code: null, type: null, errorType: null, providerCode: null, message: null }
    }
    const errorMetadata = isRecord(parsed.error.metadata) ? parsed.error.metadata : null
    const topLevelMetadata = isRecord(parsed.metadata) ? parsed.metadata : null
    const nestedProviderError = readNestedProviderError(errorMetadata?.raw)
    return {
      code: boundedProviderErrorToken(parsed.error.code)
        ?? boundedProviderErrorToken(nestedProviderError?.code),
      type: boundedProviderErrorToken(parsed.error.type)
        ?? boundedProviderErrorToken(nestedProviderError?.type),
      errorType: boundedProviderErrorToken(parsed.error_type)
        ?? boundedProviderErrorToken(parsed.error.error_type)
        ?? boundedProviderErrorToken(errorMetadata?.error_type)
        ?? boundedProviderErrorToken(topLevelMetadata?.error_type)
        ?? boundedProviderErrorToken(nestedProviderError?.error_type),
      providerCode: boundedProviderErrorToken(errorMetadata?.provider_code)
        ?? boundedProviderErrorToken(errorMetadata?.provider_error_code)
        ?? boundedProviderErrorToken(topLevelMetadata?.provider_code)
        ?? boundedProviderErrorToken(topLevelMetadata?.provider_error_code)
        ?? boundedProviderErrorToken(nestedProviderError?.code),
      message: boundedProviderErrorMessage(nestedProviderError?.message)
        ?? boundedProviderErrorMessage(parsed.error.message),
    }
  } catch {
    return { code: null, type: null, errorType: null, providerCode: null, message: null }
  }
}

function canonicalCodexErrorResponse(params: {
  readonly source: Response
  readonly status: 400 | 429 | 500 | 503
  readonly type: string
  readonly code: string
  readonly message: string | null
}): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  })
  const retryAfter = params.source.headers.get('retry-after')?.trim()
  if (retryAfter) headers.set('Retry-After', retryAfter)
  return Response.json({
    error: {
      type: params.type,
      code: params.code,
      message: params.message ?? params.code,
    },
  }, { status: params.status, headers })
}

function canonicalCodexStreamFailureResponse(params: {
  readonly code: string
  readonly message: string | null
}): Response {
  const event = {
    type: 'response.failed',
    sequence_number: 0,
    response: {
      id: 'resp_wao_gateway_failure',
      object: 'response',
      created_at: 0,
      status: 'failed',
      background: false,
      error: {
        code: params.code,
        message: params.message ?? params.code,
      },
      incomplete_details: null,
      usage: null,
      metadata: {},
    },
  }
  return new Response(
    `event: response.failed\ndata: ${JSON.stringify(event)}\n\n`,
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/event-stream',
      },
    },
  )
}

function hasProviderErrorToken(
  metadata: ProviderErrorMetadata,
  values: ReadonlySet<string>,
): boolean {
  return Boolean(
    (metadata.code && values.has(metadata.code))
    || (metadata.type && values.has(metadata.type))
    || (metadata.errorType && values.has(metadata.errorType))
    || (metadata.providerCode && values.has(metadata.providerCode))
  )
}

const PROVIDER_BILLING_ERROR_TOKENS = new Set([
  'billing_required',
  'insufficient_balance',
  'insufficient_credits',
  'insufficient_quota',
  'payment_required',
  'usage_not_included',
])

const PROVIDER_POLICY_ERROR_TOKENS = new Set([
  'content_policy_violation',
  'cyber_policy',
  'policy_violation',
])

const PROVIDER_CONTEXT_ERROR_TOKENS = new Set([
  'context_length_exceeded',
  'context_window_exceeded',
  'max_tokens_exceeded',
  'string_too_long',
  'token_limit_exceeded',
])

const PROVIDER_OVERLOAD_ERROR_TOKENS = new Set([
  'overloaded',
  'provider_overloaded',
  'provider_unavailable',
  'server_is_overloaded',
  'slow_down',
])

/**
 * Project every Provider failure into the error vocabulary supported by the
 * pinned official Codex app-server. This is the sole Provider adaptation
 * boundary: no Runtime fork, terminal side channel, or message parsing is used.
 */
export async function projectCodexProviderResponse(
  response: Response,
): Promise<CodexProviderResponseProjection> {
  const providerStatus = response.status
  if (response.ok) {
    return {
      response: projectTransparentProviderResponse(response),
      failureKind: null,
      providerStatus,
      providerCode: null,
      providerErrorType: null,
    }
  }

  const metadata = await readProviderErrorMetadata(response)
  const providerCode = metadata.providerCode ?? metadata.code ?? metadata.type
  const providerErrorType = metadata.errorType
  if (
    providerStatus === 402
    || hasProviderErrorToken(metadata, PROVIDER_BILLING_ERROR_TOKENS)
  ) {
    return {
      response: canonicalCodexErrorResponse({
        source: response,
        status: 429,
        type: 'usage_not_included',
        code: 'usage_not_included',
        message: metadata.message,
      }),
      failureKind: 'billing_required',
      providerStatus,
      providerCode,
      providerErrorType,
    }
  }
  if (hasProviderErrorToken(metadata, PROVIDER_POLICY_ERROR_TOKENS)) {
    return {
      response: canonicalCodexStreamFailureResponse({
        code: 'cyber_policy',
        message: metadata.message,
      }),
      failureKind: 'policy_rejected',
      providerStatus,
      providerCode,
      providerErrorType,
    }
  }
  if (hasProviderErrorToken(metadata, PROVIDER_CONTEXT_ERROR_TOKENS)) {
    return {
      response: canonicalCodexStreamFailureResponse({
        code: 'context_length_exceeded',
        message: metadata.message,
      }),
      failureKind: 'context_exceeded',
      providerStatus,
      providerCode,
      providerErrorType,
    }
  }
  if (providerStatus === 429) {
    return {
      response: projectTransparentProviderResponse(response),
      failureKind: 'rate_limited',
      providerStatus,
      providerCode,
      providerErrorType,
    }
  }
  if (hasProviderErrorToken(metadata, PROVIDER_OVERLOAD_ERROR_TOKENS)) {
    return {
      response: canonicalCodexErrorResponse({
        source: response,
        status: 503,
        type: 'server_error',
        code: 'slow_down',
        message: metadata.message,
      }),
      failureKind: 'temporarily_unavailable',
      providerStatus,
      providerCode,
      providerErrorType,
    }
  }
  if (providerStatus === 401 || providerStatus === 403 || providerStatus === 404) {
    return {
      response: canonicalCodexErrorResponse({
        source: response,
        status: 503,
        type: 'server_error',
        code: 'slow_down',
        message: metadata.message,
      }),
      failureKind: 'configuration_unavailable',
      providerStatus,
      providerCode,
      providerErrorType,
    }
  }
  if (providerStatus >= 400 && providerStatus < 500) {
    return {
      response: canonicalCodexErrorResponse({
        source: response,
        status: 400,
        type: 'invalid_request_error',
        code: 'invalid_request',
        message: metadata.message,
      }),
      failureKind: 'request_rejected',
      providerStatus,
      providerCode,
      providerErrorType,
    }
  }
  if (providerStatus >= 500) {
    return {
      response: canonicalCodexErrorResponse({
        source: response,
        status: 503,
        type: 'server_error',
        code: 'slow_down',
        message: metadata.message,
      }),
      failureKind: 'temporarily_unavailable',
      providerStatus,
      providerCode,
      providerErrorType,
    }
  }
  return {
    response: canonicalCodexErrorResponse({
      source: response,
      status: 500,
      type: 'server_error',
      code: 'provider_response_invalid',
      message: metadata.message,
    }),
    failureKind: 'temporarily_unavailable',
    providerStatus,
    providerCode,
    providerErrorType,
  }
}
