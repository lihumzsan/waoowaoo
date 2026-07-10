import type { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-errors'
import { createProjectAgentOperationRegistryForApi } from '@/lib/operations/registry'
import {
  commitOperationPlan,
  planOperation,
  resolveConfirmedMaxCostForExecution,
} from '@/lib/operations/planning'
import { publishWorkspaceResourceChangedEventsFromWriteResult } from '@/lib/workspace-resource/resource-change-events'
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
    selectedPanelId?: string | null
    selectedAssetId?: string | null
  }
  input: unknown
  source?: string
}) {
  const registry = createProjectAgentOperationRegistryForApi()
  const operation = registry[params.operationId]
  if (!operation) {
    throw new ApiError('NOT_FOUND', {
      message: `operation not found: ${params.operationId}`,
    })
  }

  const parsed = operation.inputSchema.safeParse(params.input)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS', {
      message: 'INVALID_PARAMS',
      issues: parsed.error.issues,
    })
  }

  const operationContext = {
      request: params.request,
      userId: params.userId,
      projectId: params.projectId,
      context: {
        ...(params.context?.locale ? { locale: params.context.locale } : {}),
        ...(params.context?.episodeId ? { episodeId: params.context.episodeId } : {}),
        ...(params.context?.selectedScopeRef ? { selectedScopeRef: params.context.selectedScopeRef } : {}),
        ...(params.context?.selectedPanelId ? { selectedPanelId: params.context.selectedPanelId } : {}),
        ...(params.context?.selectedAssetId ? { selectedAssetId: params.context.selectedAssetId } : {}),
      },
      source: params.source || 'project-ui',
      writer: null,
      toolCallId: null,
    }

  try {
    const result = operation.plan && operation.commit
      ? await (async () => {
          const plan = await planOperation({
            operation,
            ctx: operationContext,
            input: parsed.data,
          })
          return await commitOperationPlan({
            operation,
            ctx: operationContext,
            input: parsed.data,
            plan,
            confirmedMaxCost: await resolveConfirmedMaxCostForExecution({
              ctx: operationContext,
              input: parsed.data,
              plan,
            }),
          })
        })()
      : await operation.execute(operationContext, parsed.data)
    const outputParsed = operation.outputSchema.safeParse(result)
    if (!outputParsed.success) {
      throw new ApiError('EXTERNAL_ERROR', {
        code: 'OPERATION_OUTPUT_INVALID',
        message: `operation output schema mismatch: ${params.operationId}`,
        issues: outputParsed.error.issues,
      })
    }
    await publishWorkspaceResourceChangedEventsFromWriteResult({
      result: outputParsed.data,
      fallbackProjectId: params.projectId,
      userId: params.userId,
      fallbackEpisodeId: params.context?.episodeId ?? null,
    })
    return outputParsed.data
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
