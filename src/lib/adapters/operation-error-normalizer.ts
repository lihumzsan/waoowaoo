import { ApiError } from '@/lib/api-errors'
import type { ProjectAgentToolError, ProjectAgentToolErrorCode } from '@/lib/operations/types'

type SuspensionKind = 'choice'

const SENSITIVE_DETAIL_KEYS = new Set([
  'authorization',
  'apikey',
  'api_key',
  'cookie',
  'password',
  'privatekey',
  'private_key',
  'secret',
  'set-cookie',
  'stack',
  'token',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeDetailKey(key: string): string {
  return key.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
}

function sanitizeDetailValue(value: unknown, depth = 0): unknown {
  if (value === undefined) return undefined
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value)) {
    if (depth >= 4) return '[truncated]'
    return value.map((item) => sanitizeDetailValue(item, depth + 1))
  }
  if (isRecord(value)) {
    if (depth >= 4) return '[truncated]'
    const entries: Array<[string, unknown]> = []
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_DETAIL_KEYS.has(normalizeDetailKey(key))) continue
      const sanitized = sanitizeDetailValue(item, depth + 1)
      if (sanitized !== undefined) entries.push([key, sanitized])
    }
    return Object.fromEntries(entries)
  }
  return String(value)
}

function sanitizeDetails(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  const sanitized = sanitizeDetailValue(value)
  return isRecord(sanitized) ? sanitized : null
}

export function toOperationErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim()
    return message || fallback
  }
  if (typeof error === 'string' && error.trim()) return error.trim()
  try {
    const serialized = JSON.stringify(error)
    if (typeof serialized === 'string' && serialized.trim()) return serialized.trim()
    return fallback
  } catch {
    return fallback
  }
}

export function extractPrismaMissingColumn(error: unknown): string | null {
  if (!isRecord(error)) return null
  if (error.code !== 'P2022') return null
  const meta = isRecord(error.meta) ? error.meta : null
  const column = typeof meta?.column === 'string' ? meta.column.trim() : ''
  return column || null
}

export function inferApiErrorCodeFromMessage(message: string): 'NOT_FOUND' | 'INVALID_PARAMS' | 'FORBIDDEN' | 'UNAUTHORIZED' | 'CONFLICT' | null {
  const lower = message.toLowerCase()
  if (lower.includes('unauthorized') || lower.includes('need login') || lower.includes('not authenticated')) return 'UNAUTHORIZED'
  if (lower.includes('forbidden') || lower.includes('permission denied')) return 'FORBIDDEN'
  if (lower.includes('not found') || lower.includes('不存在') || lower.includes('missing record') || lower.includes('not_found')) return 'NOT_FOUND'
  if (lower.includes('conflict') || lower.includes('already exists') || lower.includes('duplicate')) return 'CONFLICT'
  if (lower.includes('invalid') || lower.includes('missing') || lower.includes('required') || lower.includes('bad request')) return 'INVALID_PARAMS'
  return null
}

export function buildToolError(params: {
  code: ProjectAgentToolErrorCode
  message: string
  operationId: string
  details?: Record<string, unknown> | null
  issues?: unknown
}): ProjectAgentToolError {
  return {
    code: params.code,
    message: params.message,
    operationId: params.operationId,
    details: params.details ?? null,
    ...(params.issues !== undefined ? { issues: params.issues } : {}),
  }
}

export function withOperationErrorDetails(
  operation: { agentFlow?: { suspendsFor?: SuspensionKind | null } },
  details?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const suspendsFor = operation.agentFlow?.suspendsFor ?? null
  if (!suspendsFor) return details ?? null
  return {
    ...(details ?? {}),
    suspendsFor,
  }
}

export function normalizeOperationExecutionToolError(params: {
  error: unknown
  operation: { agentFlow?: { suspendsFor?: SuspensionKind | null } }
  operationId: string
}): ProjectAgentToolError {
  if (params.error instanceof ApiError) {
    const sanitizedDetails = sanitizeDetails(params.error.details) ?? {}
    const reasonCode = typeof sanitizedDetails.code === 'string' && sanitizedDetails.code.trim()
      ? sanitizedDetails.code.trim()
      : null
    return buildToolError({
      code: 'OPERATION_EXECUTION_FAILED',
      message: params.error.message || 'PROJECT_AGENT_OPERATION_FAILED',
      operationId: params.operationId,
      details: withOperationErrorDetails(params.operation, {
        ...sanitizedDetails,
        apiErrorCode: params.error.code,
        httpStatus: params.error.status,
        retryable: params.error.retryable,
        category: params.error.category,
        userMessageKey: params.error.userMessageKey,
        message: params.error.message,
        ...(reasonCode ? { reasonCode } : {}),
      }),
    })
  }

  return buildToolError({
    code: 'OPERATION_EXECUTION_FAILED',
    message: toOperationErrorMessage(params.error, 'PROJECT_AGENT_OPERATION_FAILED'),
    operationId: params.operationId,
    details: withOperationErrorDetails(
      params.operation,
      params.error instanceof Error && params.error.cause
        ? { cause: sanitizeDetailValue(params.error.cause) }
        : null,
    ),
  })
}
