import type { UIMessage, UIMessageStreamWriter } from 'ai'
import type { NextRequest } from 'next/server'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import { isConfirmedOperationInput } from '@/lib/operations/confirmation'
import {
  type ProjectAgentToolResult,
} from '@/lib/operations/types'
import {
  shouldRequireAssistantToolApproval,
  type AssistantPermissionMode,
} from '@/lib/project-agent/permission-mode'
import type { ProjectAgentContext } from '@/lib/project-agent/types'
import { publishWorkspaceResourceChangedEventsFromWriteResult } from '@/lib/workspace-resource/resource-change-events'
import {
  buildToolError,
  normalizeOperationExecutionToolError,
  withOperationErrorDetails,
} from '@/lib/adapters/operation-error-normalizer'

function attachConfirmedMaxCost(input: unknown, confirmedMaxCost: number | undefined): unknown {
  if (typeof confirmedMaxCost !== 'number' || !Number.isFinite(confirmedMaxCost)) return input
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      value: input,
      confirmedMaxCost,
    }
  }
  return {
    ...(input as Record<string, unknown>),
    confirmedMaxCost,
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

  const parsed = operation.inputSchema.safeParse(params.input)
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

  const confirmedMaxCost = params.context.confirmedMaxCostByOperationId?.[params.operationId]
  const parsedInput = attachConfirmedMaxCost(parsed.data, confirmedMaxCost)
  const contextEpisodeId = typeof params.context.episodeId === 'string' ? params.context.episodeId.trim() : ''
  const inputEpisodeId = (() => {
    const data = parsedInput
    if (!data || typeof data !== 'object' || Array.isArray(data)) return ''
    const record = data as Record<string, unknown>
    const value = record.episodeId
    return typeof value === 'string' ? value.trim() : ''
  })()
  const effectiveEpisodeId = contextEpisodeId || inputEpisodeId
  const hasEpisodeId = effectiveEpisodeId.length > 0

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
          actual: effectiveEpisodeId,
          source: contextEpisodeId ? 'context' : 'input',
        }),
      }),
    }
  }

  const requiresConfirmation = shouldRequireAssistantToolApproval({
    mode: params.assistantPermissionMode,
    operation,
  })
  if (requiresConfirmation && !isConfirmedOperationInput(params.input)) {
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

  let result: unknown
  try {
    result = await operation.execute({
      request: params.request,
      userId: params.userId,
      projectId: params.projectId,
      context: params.context,
      source: params.source,
      writer: params.writer,
      toolCallId: params.toolCallId,
    }, parsedInput)
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
    fallbackEpisodeId: effectiveEpisodeId || null,
  })
  return {
    ok: true,
    data: outputParsed.data,
  }
}
