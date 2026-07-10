import type { UIMessage, UIMessageStreamWriter } from 'ai'
import type { NextRequest } from 'next/server'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import { type ProjectAgentToolResult } from '@/lib/operations/types'
import { commitOperationPlan, planOperation, toOperationPlanView } from '@/lib/operations/planning'
import { invokeApprovedOperationPlan } from '@/lib/operations/planned-operation-invocation'
import { shouldRequireAssistantToolApproval, type AssistantPermissionMode } from '@/lib/project-agent/permission-mode'
import type { ProjectAgentContext, ProjectAgentOperationPlanPreviewPartData } from '@/lib/project-agent/types'
import { publishWorkspaceResourceChangedEventsFromWriteResult } from '@/lib/workspace-resource/resource-change-events'
import { buildToolError, normalizeOperationExecutionToolError, withOperationErrorDetails } from '@/lib/adapters/operation-error-normalizer'
import { writeOperationDataPart } from '@/lib/operations/types'
import { resolveOperationEffectiveEpisodeId, resolveOperationScopeInput } from '@/lib/operations/environment-input'

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
}): Promise<ProjectAgentToolResult<unknown>> {
  const registry = createProjectAgentOperationRegistry()
  const operation = registry[params.operationId]
  if (!operation) {
    return {
      ok: false,
      error: buildToolError({
        code: 'OPERATION_NOT_FOUND',
        message: `operation not found: ${params.operationId}`,
        operationId: params.operationId,
      }),
    }
  }

  const scopedInput = resolveOperationScopeInput({
    input: params.input,
    context: params.context,
    prerequisites: operation.prerequisites,
  })
  const effectiveEpisode = resolveOperationEffectiveEpisodeId({
    input: scopedInput,
    context: params.context,
  })
  const hasEpisodeId = effectiveEpisode.episodeId.length > 0

  if (operation.prerequisites.episodeId === 'required' && !hasEpisodeId) {
    return {
      ok: false,
      error: buildToolError({
        code: 'OPERATION_PREREQUISITE_MISSING',
        message: 'PROJECT_AGENT_OPERATION_PREREQUISITE_EPISODE_REQUIRED',
        operationId: params.operationId,
        details: withOperationErrorDetails(operation, {
          prerequisite: 'episodeId',
          required: 'required',
          actual: null,
        }),
      }),
    }
  }

  if (operation.prerequisites.episodeId === 'forbidden' && hasEpisodeId) {
    return {
      ok: false,
      error: buildToolError({
        code: 'OPERATION_PREREQUISITE_MISSING',
        message: 'PROJECT_AGENT_OPERATION_PREREQUISITE_EPISODE_FORBIDDEN',
        operationId: params.operationId,
        details: withOperationErrorDetails(operation, {
          prerequisite: 'episodeId',
          required: 'forbidden',
          actual: effectiveEpisode.episodeId,
          source: effectiveEpisode.source,
        }),
      }),
    }
  }

  const parsed = operation.inputSchema.safeParse(scopedInput)
  if (!parsed.success) {
    return {
      ok: false,
      error: buildToolError({
        code: 'OPERATION_INPUT_INVALID',
        message: 'PROJECT_AGENT_INVALID_OPERATION_INPUT',
        operationId: params.operationId,
        details: withOperationErrorDetails(operation),
        issues: parsed.error.issues,
      }),
    }
  }
  const parsedInput = parsed.data

  const requiresConfirmation = shouldRequireAssistantToolApproval({
    mode: params.assistantPermissionMode,
    operation,
  })
  const approvedInvocation = params.context.approvedInvocationByOperationId?.[params.operationId] ?? null
  if (operation.confirmation.kind === 'billable_media' && requiresConfirmation && !approvedInvocation) {
    return {
      ok: false,
      confirmationRequired: true,
      error: buildToolError({
        code: 'CONFIRMATION_REQUIRED',
        message: 'PROJECT_AGENT_OPERATION_APPROVAL_REQUIRED',
        operationId: params.operationId,
        details: withOperationErrorDetails(operation, {
          approval: 'ai-sdk-tool-approval',
        }),
      }),
    }
  }

  const operationContext = {
    request: params.request,
    userId: params.userId,
    projectId: params.projectId,
    context: params.context,
    source: params.source,
    writer: params.writer,
    toolCallId: params.toolCallId,
  }
  let result: unknown
  try {
    if (operation.confirmation.kind === 'billable_media') {
      if (!approvedInvocation) {
        throw new Error(`PROJECT_AGENT_APPROVAL_GRANT_REQUIRED:${params.operationId}`)
      }
      result = await invokeApprovedOperationPlan({
        operation,
        ctx: operationContext,
        normalizedInput: parsedInput,
        invocation: approvedInvocation,
      })
    } else if (operation.plan && operation.commit) {
      const plan = await planOperation({
        operation,
        ctx: operationContext,
        input: parsedInput,
      })
      const operationPlan = await toOperationPlanView(plan)
      if (operationPlan.quote.billable) {
        writeOperationDataPart<ProjectAgentOperationPlanPreviewPartData>(params.writer, 'data-agent-operation-plan-preview', {
          operationId: params.operationId,
          ...(params.toolCallId ? { toolCallId: params.toolCallId } : {}),
          operationPlan,
        })
      }
      result = await commitOperationPlan({
        operation,
        ctx: operationContext,
        input: parsedInput,
        plan,
      })
    } else {
      if (!operation.execute) throw new Error(`DIRECT_OPERATION_EXECUTOR_MISSING:${operation.id}`)
      result = await operation.execute(operationContext, parsedInput)
    }
  } catch (error) {
    return {
      ok: false,
      error: normalizeOperationExecutionToolError({
        error,
        operation,
        operationId: params.operationId,
      }),
    }
  }
  const outputParsed = operation.outputSchema.safeParse(result)
  if (!outputParsed.success) {
    return {
      ok: false,
      error: buildToolError({
        code: 'OPERATION_OUTPUT_INVALID',
        message: 'PROJECT_AGENT_OPERATION_OUTPUT_INVALID',
        operationId: params.operationId,
        details: withOperationErrorDetails(operation),
        issues: outputParsed.error.issues,
      }),
    }
  }
  await publishWorkspaceResourceChangedEventsFromWriteResult({
    result: outputParsed.data,
    fallbackProjectId: params.projectId,
    userId: params.userId,
    fallbackEpisodeId: effectiveEpisode.episodeId || null,
  })
  return {
    ok: true,
    data: outputParsed.data,
  }
}
