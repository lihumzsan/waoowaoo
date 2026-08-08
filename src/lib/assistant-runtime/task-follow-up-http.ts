import { timingSafeEqual } from 'node:crypto'
import { getInternalBaseUrl } from '@/lib/env'
import type { AssistantRuntimeTaskFollowUpReceipt } from './contracts'

export const ASSISTANT_RUNTIME_TASK_FOLLOW_UP_PATH =
  '/api/internal/codex-runtime/follow-up' as const

const REQUEST_TIMEOUT_MS = 55_000
const MAX_BATCH_ID_CHARS = 512

export type AssistantRuntimeTaskFollowUpHttpRequest = {
  readonly batchId: string
}

export type AssistantRuntimeTaskFollowUpHttpResponse =
  | {
      readonly ok: true
      readonly receipt: AssistantRuntimeTaskFollowUpReceipt
    }
  | {
      readonly ok: false
      readonly code: string
    }

export class AssistantRuntimeTaskFollowUpHttpError extends Error {
  readonly code: string
  readonly httpStatus: number | null
  override readonly cause?: unknown

  constructor(input: {
    readonly code: string
    readonly httpStatus: number | null
    readonly cause?: unknown
  }) {
    super(input.code)
    this.name = 'AssistantRuntimeTaskFollowUpHttpError'
    this.code = input.code
    this.httpStatus = input.httpStatus
    this.cause = input.cause
  }
}

function requireCronSecret(): string {
  const value = process.env.CRON_SECRET
  if (!value || !value.trim() || value !== value.trim()) {
    throw new AssistantRuntimeTaskFollowUpHttpError({
      code: 'ASSISTANT_RUNTIME_INTERNAL_AUTH_UNAVAILABLE',
      httpStatus: null,
    })
  }
  return value
}

function requireBatchId(value: unknown): string {
  if (
    typeof value !== 'string'
    || !value.trim()
    || value !== value.trim()
    || value.length > MAX_BATCH_ID_CHARS
  ) {
    throw new AssistantRuntimeTaskFollowUpHttpError({
      code: 'ASSISTANT_RUNTIME_FOLLOW_UP_BATCH_ID_INVALID',
      httpStatus: null,
    })
  }
  return value
}

export function parseAssistantRuntimeTaskFollowUpHttpRequest(
  value: unknown,
): AssistantRuntimeTaskFollowUpHttpRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { batchId: requireBatchId(null) }
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => key !== 'batchId')) {
    return { batchId: requireBatchId(null) }
  }
  return { batchId: requireBatchId(record.batchId) }
}

export function buildAssistantRuntimeTaskFollowUpAuthorization(): string {
  return `Bearer ${requireCronSecret()}`
}

export function verifyAssistantRuntimeTaskFollowUpAuthorization(
  authorization: string | null,
): boolean {
  if (!authorization) return false
  const match = /^Bearer ([^\s]+)$/.exec(authorization)
  if (!match?.[1]) return false
  const expected = Buffer.from(requireCronSecret(), 'utf8')
  const actual = Buffer.from(match[1], 'utf8')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function isReceipt(value: unknown): value is AssistantRuntimeTaskFollowUpReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.outcome === 'cancelled') {
    return typeof record.batchId === 'string' && record.batchId.length > 0
  }
  return (
    (record.outcome === 'accepted' || record.outcome === 'replayed')
    && typeof record.batchId === 'string'
    && record.batchId.length > 0
    && typeof record.threadId === 'string'
    && record.threadId.length > 0
    && typeof record.turnId === 'string'
    && record.turnId.length > 0
    && (record.runtimeThreadId === null || typeof record.runtimeThreadId === 'string')
    && (record.runtimeTurnId === null || typeof record.runtimeTurnId === 'string')
  )
}

function parseResponse(
  value: unknown,
  httpStatus: number,
): AssistantRuntimeTaskFollowUpHttpResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AssistantRuntimeTaskFollowUpHttpError({
      code: 'ASSISTANT_RUNTIME_FOLLOW_UP_HTTP_RESPONSE_INVALID',
      httpStatus,
      cause: value,
    })
  }
  const record = value as Record<string, unknown>
  if (record.ok === true && isReceipt(record.receipt)) {
    return { ok: true, receipt: record.receipt }
  }
  if (
    record.ok === false
    && typeof record.code === 'string'
    && record.code.trim() === record.code
    && record.code.length > 0
  ) {
    return {
      ok: false,
      code: record.code,
    }
  }
  throw new AssistantRuntimeTaskFollowUpHttpError({
    code: 'ASSISTANT_RUNTIME_FOLLOW_UP_HTTP_RESPONSE_INVALID',
    httpStatus,
    cause: value,
  })
}

export async function requestAssistantRuntimeTaskFollowUp(
  batchId: string,
): Promise<AssistantRuntimeTaskFollowUpReceipt> {
  const request = parseAssistantRuntimeTaskFollowUpHttpRequest({ batchId })
  const baseUrl = getInternalBaseUrl().replace(/\/+$/, '')
  let response: Response
  try {
    response = await fetch(`${baseUrl}${ASSISTANT_RUNTIME_TASK_FOLLOW_UP_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: buildAssistantRuntimeTaskFollowUpAuthorization(),
        'Content-Type': 'application/json',
        'Idempotency-Key': `task-follow-up:${request.batchId}`,
      },
      body: JSON.stringify(request),
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof AssistantRuntimeTaskFollowUpHttpError) throw error
    throw new AssistantRuntimeTaskFollowUpHttpError({
      code: 'ASSISTANT_RUNTIME_FOLLOW_UP_HTTP_UNAVAILABLE',
      httpStatus: null,
      cause: error,
    })
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    throw new AssistantRuntimeTaskFollowUpHttpError({
      code: 'ASSISTANT_RUNTIME_FOLLOW_UP_HTTP_RESPONSE_INVALID',
      httpStatus: response.status,
      cause: error,
    })
  }
  const parsed = parseResponse(body, response.status)
  if (parsed.ok && response.ok) {
    if (parsed.receipt.batchId !== request.batchId) {
      throw new AssistantRuntimeTaskFollowUpHttpError({
        code: 'ASSISTANT_RUNTIME_FOLLOW_UP_HTTP_RECEIPT_DIVERGED',
        httpStatus: response.status,
        cause: parsed.receipt,
      })
    }
    return parsed.receipt
  }
  if (!parsed.ok) {
    throw new AssistantRuntimeTaskFollowUpHttpError({
      code: parsed.code,
      httpStatus: response.status,
      cause: body,
    })
  }
  throw new AssistantRuntimeTaskFollowUpHttpError({
    code: 'ASSISTANT_RUNTIME_FOLLOW_UP_HTTP_STATUS_DIVERGED',
    httpStatus: response.status,
    cause: body,
  })
}
