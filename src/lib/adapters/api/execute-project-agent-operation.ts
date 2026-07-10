import type { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-errors'
import { createProjectAgentOperationRegistryForApi } from '@/lib/operations/registry'
import { commitOperationPlan, planOperation } from '@/lib/operations/planning'
import { invokeApprovedOperationPlan, splitPlannedOperationInvocation } from '@/lib/operations/planned-operation-invocation'
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

  const splitInput = splitPlannedOperationInvocation(params.input)
  const parsed = operation.inputSchema.safeParse(splitInput.businessInput)
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
    const result =
      operation.confirmation.kind === 'billable_media'
        ? await (async () => {
            if (!splitInput.invocation) {
              throw new ApiError('INVALID_PARAMS', {
                code: 'OPERATION_APPROVAL_GRANT_REQUIRED',
                message: 'approve the immutable operation plan before execution',
              })
            }
            return await invokeApprovedOperationPlan({
              operation,
              ctx: operationContext,
              normalizedInput: parsed.data,
              invocation: splitInput.invocation,
            })
          })()
        : operation.plan && operation.commit
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
              })
            })()
          : operation.execute
            ? await operation.execute(operationContext, parsed.data)
            : (() => {
                throw new Error(`DIRECT_OPERATION_EXECUTOR_MISSING:${operation.id}`)
              })()
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
