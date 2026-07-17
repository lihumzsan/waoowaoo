import type { UIMessage, UIMessageStreamWriter } from 'ai'
import type { NextRequest } from 'next/server'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import {
  type ProjectAgentOperationTaskBatchBinding,
  type ProjectAgentOperationOutcome,
  type ProjectAgentToolResult,
} from '@/lib/operations/types'
import { type AssistantPermissionMode } from '@/lib/project-agent/permission-mode'
import type { ProjectAgentContext } from '@/lib/project-agent/types'
import { buildToolError, normalizeOperationExecutionToolError, withOperationErrorDetails } from '@/lib/adapters/operation-error-normalizer'
import { invokeProjectAgentOperation } from '@/lib/operations/invocation'
import { ApiError } from '@/lib/api-errors'
import type { ProjectAgentOperationExecutionFence } from '@/lib/project-agent/operation-execution-fence'

export interface ProjectAgentToolExecutionResult {
  outcome: ProjectAgentOperationOutcome
  result: ProjectAgentToolResult<unknown>
}

function failedToolExecution(error: Extract<ProjectAgentToolResult<never>, { ok: false }>['error']): ProjectAgentToolExecutionResult {
  return {
    outcome: { kind: 'failed', error },
    result: { ok: false, error },
  }
}

export async function executeProjectAgentOperationFromTool(params: {
  request: NextRequest
  operationId: string
  projectId: string
  userId: string
  context: ProjectAgentContext
  assistantPermissionMode: AssistantPermissionMode
  source: string
  writer: UIMessageStreamWriter<UIMessage>
  input: unknown
  toolCallId?: string | null
  executionFence: ProjectAgentOperationExecutionFence
  taskBatchBinding?: ProjectAgentOperationTaskBatchBinding | null
}): Promise<ProjectAgentToolExecutionResult> {
  const registry = createProjectAgentOperationRegistry()
  const operation = registry[params.operationId]
  const toolCallId = params.toolCallId?.trim() || null
  const approvedInvocation = toolCallId
    ? params.context.approvedInvocationByToolCallId?.[toolCallId] ?? null
    : null
  const operationContext = {
    request: params.request,
    userId: params.userId,
    projectId: params.projectId,
    context: params.context,
    source: params.source,
    writer: params.writer,
    toolCallId: params.toolCallId,
    executionFence: params.executionFence,
    taskBatchBinding: params.taskBatchBinding ?? null,
  }
  try {
    const result = await invokeProjectAgentOperation({
      registry,
      channel: 'tool',
      operationId: params.operationId,
      context: operationContext,
      input: params.input,
      approvedInvocation,
      returnApprovalRequired: true,
    })
    if (result.kind === 'approval_required') {
      const toolResult: ProjectAgentToolResult<unknown> = {
        ok: false,
        confirmationRequired: true,
        error: buildToolError({
          code: 'CONFIRMATION_REQUIRED',
          message: 'PROJECT_AGENT_OPERATION_APPROVAL_REQUIRED',
          operationId: params.operationId,
          details: withOperationErrorDetails(result.operation, {
            approval: 'ai-sdk-tool-approval',
          }),
        }),
      }
      return { outcome: result.outcome, result: toolResult }
    }
    return { outcome: result.outcome, result: { ok: true, data: result.data } }
  } catch (error) {
    if (error instanceof ApiError) {
      const reasonCode = typeof error.details?.code === 'string' ? error.details.code : null
      const mappedCode = reasonCode === 'OPERATION_NOT_FOUND'
        ? 'OPERATION_NOT_FOUND'
        : reasonCode === 'OPERATION_PLAN_CHANGED'
          ? 'OPERATION_PLAN_CHANGED'
          : reasonCode === 'OPERATION_NOT_ALLOWED'
            ? 'OPERATION_NOT_ALLOWED'
            : reasonCode === 'OPERATION_PREREQUISITE_MISSING'
              ? 'OPERATION_PREREQUISITE_MISSING'
              : reasonCode === 'OPERATION_INPUT_INVALID' ||
                  reasonCode === 'LEGACY_OPERATION_CONFIRMATION_UNSUPPORTED' ||
                  reasonCode === 'OPERATION_PLAN_INVOCATION_AMBIGUOUS' ||
                  reasonCode === 'APPROVAL_GRANT_NOT_APPLICABLE'
                ? 'OPERATION_INPUT_INVALID'
                : reasonCode === 'OPERATION_OUTPUT_INVALID'
                  ? 'OPERATION_OUTPUT_INVALID'
                  : null
      if (mappedCode) {
        return failedToolExecution(buildToolError({
            code: mappedCode,
            message: error.message,
            operationId: params.operationId,
            details: operation ? withOperationErrorDetails(operation, error.details ?? null) : error.details ?? null,
            ...(error.details?.issues !== undefined ? { issues: error.details.issues } : {}),
        }))
      }
    }
    return failedToolExecution(normalizeOperationExecutionToolError({
        error,
        operation: operation ?? {},
        operationId: params.operationId,
    }))
  }
}
