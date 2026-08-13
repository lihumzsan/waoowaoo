import { ApiError } from '@/lib/api-errors'
import { createScopedLogger } from '@/lib/logging/core'
import type { ProjectAgentToolError, ProjectAgentToolErrorCode } from '@/lib/operations/types'
import { getErrorSpec } from '@/lib/errors/codes'
import { normalizeAnyError } from '@/lib/errors/normalize'
import { projectErrorForModel, projectModelErrorDetails } from '@/lib/errors/projection'

const logger = createScopedLogger({ module: 'assistant.tool' })

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readSafeReasonCode(details: Record<string, unknown> | null | undefined): string | null {
  const value = typeof details?.reasonCode === 'string'
    ? details.reasonCode
    : typeof details?.code === 'string'
      ? details.code
      : ''
  const normalized = value.trim()
  return /^[A-Z][A-Z0-9_]{0,127}$/.test(normalized) ? normalized : null
}

export function extractPrismaMissingColumn(error: unknown): string | null {
  if (!isRecord(error)) return null
  if (error.code !== 'P2022') return null
  const meta = isRecord(error.meta) ? error.meta : null
  const column = typeof meta?.column === 'string' ? meta.column.trim() : ''
  return column || null
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

export function normalizeOperationExecutionToolError(params: {
  error: unknown
  operationId: string
}): ProjectAgentToolError {
  const normalized = normalizeAnyError(params.error, {
    fallbackCode: 'INTERNAL_ERROR',
  })
  const toolError = buildOperationExecutionToolError({
    ...params,
    normalized,
  })
  // Single normalization entry for tool execution exceptions: log here once so
  // failures returned to the model as tool-error payloads stay server-visible.
  logger.error({
    action: 'assistant.tool.execution_failed',
    message: 'assistant tool execution failed; error normalized into tool payload',
    operationId: params.operationId,
    errorCode: params.error instanceof ApiError ? params.error.code : toolError.code,
    details: {
      ...toolError.details,
      diagnosticFailure: normalized,
    },
    error: params.error instanceof Error
      ? { name: params.error.name, message: params.error.message, stack: params.error.stack }
      : { message: toolError.message },
  })
  return toolError
}

function buildOperationExecutionToolError(params: {
  error: unknown
  operationId: string
  normalized?: ReturnType<typeof normalizeAnyError>
}): ProjectAgentToolError {
  const normalized = params.normalized ?? normalizeAnyError(params.error, {
    fallbackCode: 'INTERNAL_ERROR',
  })
  const safeDetails = projectModelErrorDetails(normalized.interpretation.details)
  const reasonCode = readSafeReasonCode(normalized.interpretation.details)
    ?? readSafeReasonCode(safeDetails)
  const failure = projectErrorForModel(normalized)
  return buildToolError({
    code: 'OPERATION_EXECUTION_FAILED',
    message: getErrorSpec(failure.code).defaultMessage,
    operationId: params.operationId,
    details: {
      failure,
      ...safeDetails,
      ...(reasonCode ? { reasonCode } : {}),
    },
  })
}
