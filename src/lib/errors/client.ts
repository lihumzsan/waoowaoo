import { parseApiErrorPayload } from '@/lib/api-error-payload'
import { resolveUnifiedErrorCode } from '@/lib/errors/codes'

const BARE_ERROR_CODE = /^[A-Z][A-Z0-9_]{2,}$/

export interface ClientErrorFacts {
  code: string | null
  requestId: string | null
  status: number | null
}

export class ClientApiError extends Error {
  readonly code: string | null
  readonly requestId: string | null
  readonly status: number | null
  readonly payload: Record<string, unknown> | null

  constructor(facts: ClientErrorFacts, payload: Record<string, unknown> | null = null) {
    super(facts.code ?? 'INTERNAL_ERROR')
    this.name = 'ClientApiError'
    this.code = facts.code
    this.requestId = facts.requestId
    this.status = facts.status
    this.payload = payload
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readDomainCode(details: Record<string, unknown> | null): string | null {
  const code = details?.code
  return resolveUnifiedErrorCode(code)
}

function parseTextPayload(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return BARE_ERROR_CODE.test(trimmed) ? { code: trimmed } : null
  }
}

function codeFromStatus(status: number | null): string | null {
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 413) return 'PAYLOAD_TOO_LARGE'
  if (status === 429) return 'RATE_LIMIT'
  if (status !== null && status >= 500) return 'INTERNAL_ERROR'
  return null
}

export function parseClientError(
  input: unknown,
  status: number | null = null,
): ClientErrorFacts {
  if (input instanceof ClientApiError) {
    return { code: input.code, requestId: input.requestId, status: input.status }
  }
  if (input instanceof TypeError) {
    return { code: 'NETWORK_ERROR', requestId: null, status }
  }
  const payload = typeof input === 'string'
    ? parseTextPayload(input)
    : input instanceof Error
      ? parseTextPayload(input.message)
      : input
  const parsed = parseApiErrorPayload(payload)
  return {
    code: readDomainCode(parsed.details)
      ?? resolveUnifiedErrorCode(parsed.code)
      ?? codeFromStatus(status),
    requestId: parsed.requestId,
    status,
  }
}

export function createClientApiError(
  payload: unknown,
  status: number,
  headerRequestId?: string | null,
): ClientApiError {
  const record = isRecord(payload) ? payload : null
  const facts = parseClientError(payload, status)
  return new ClientApiError({
    ...facts,
    requestId: facts.requestId ?? (headerRequestId?.trim() || null),
  }, record)
}

export async function readClientApiError(response: Response): Promise<ClientApiError> {
  const payload = await response.clone().json().catch(() => null) as unknown
  return createClientApiError(
    payload,
    response.status,
    response.headers.get('x-request-id'),
  )
}

export type ErrorCodeTranslator = (code: string) => string | null

export function resolveClientErrorMessage(
  error: unknown,
  translate: ErrorCodeTranslator,
  fallback: string,
): { message: string; facts: ClientErrorFacts } {
  const facts = parseClientError(error)
  return {
    message: facts.code ? translate(facts.code)?.trim() || fallback : fallback,
    facts,
  }
}
