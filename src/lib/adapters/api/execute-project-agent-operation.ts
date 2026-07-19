import type { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-errors'
import { createProjectAgentOperationRegistryForApi } from '@/lib/operations/registry'
import { invokeProjectAgentOperation } from '@/lib/operations/invocation'
import {
  extractPrismaMissingColumn,
  inferApiErrorCodeFromMessage,
  toOperationErrorMessage,
} from '@/lib/adapters/operation-error-normalizer'

export async function executeProjectAgentOperationFromApi(params: {
  request: NextRequest
  operationId: string
  projectId: string
  userId: string
  context?: {
    locale?: string | null
    episodeId?: string | null
    selectedScopeRef?: string | null
    selectedAssetId?: string | null
  }
  input: unknown
  source?: string
}) {
  const registry = createProjectAgentOperationRegistryForApi()
  const operationContext = {
    request: params.request,
    userId: params.userId,
    projectId: params.projectId,
    context: {
      ...(params.context?.locale ? { locale: params.context.locale } : {}),
      ...(params.context?.episodeId ? { episodeId: params.context.episodeId } : {}),
      ...(params.context?.selectedScopeRef ? { selectedScopeRef: params.context.selectedScopeRef } : {}),
      ...(params.context?.selectedAssetId ? { selectedAssetId: params.context.selectedAssetId } : {}),
    },
    source: params.source || 'project-ui',
    writer: null,
    toolCallId: null,
    activityId: null,
  }

  try {
    const result = await invokeProjectAgentOperation({
      registry,
      channel: 'api',
      operationId: params.operationId,
      context: operationContext,
      input: params.input,
    })
    if (result.kind !== 'executed') {
      throw new Error(`API_OPERATION_APPROVAL_RESULT_INVALID:${params.operationId}`)
    }
    return result.data
  } catch (error) {
    if (error instanceof ApiError) throw error
    const missingColumn = extractPrismaMissingColumn(error)
    if (missingColumn) {
      throw new ApiError('EXTERNAL_ERROR', {
        code: 'DATABASE_SCHEMA_MISMATCH',
        field: missingColumn,
        message: `database schema mismatch: missing column ${missingColumn}; run the latest Prisma migration before starting the app`,
      })
    }
    const message = toOperationErrorMessage(error, 'OPERATION_FAILED')
    const inferred = inferApiErrorCodeFromMessage(message)
    if (inferred) {
      throw new ApiError(inferred, { message })
    }
    throw new ApiError('EXTERNAL_ERROR', {
      code: 'OPERATION_EXECUTION_FAILED',
      message,
    })
  }
}
