import type { UIMessage, UIMessageStreamWriter } from 'ai'
import type { NextRequest } from 'next/server'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import { isConfirmedOperationInput } from '@/lib/operations/confirmation'
import {
  type ProjectAgentToolError,
  type ProjectAgentToolErrorCode,
  type ProjectAgentToolResult,
} from '@/lib/operations/types'
import {
  shouldRequireAssistantToolApproval,
  type AssistantPermissionMode,
} from '@/lib/project-agent/permission-mode'
import type { ProjectAgentContext } from '@/lib/project-agent/types'
import { publishWorkspaceResourceChangedEventsFromWriteResult } from '@/lib/workspace-resource/resource-change-events'

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim()
    return message || 'PROJECT_AGENT_OPERATION_FAILED'
  }
  if (typeof error === 'string' && error.trim()) return error.trim()
  try {
    const serialized = JSON.stringify(error)
    if (typeof serialized === 'string' && serialized.trim()) return serialized.trim()
    return 'PROJECT_AGENT_OPERATION_FAILED'
  } catch {
    return 'PROJECT_AGENT_OPERATION_FAILED'
  }
}

function buildToolError(params: {
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
        issues: parsed.error.issues,
      }),
    }
  }

  const contextEpisodeId = typeof params.context.episodeId === 'string' ? params.context.episodeId.trim() : ''
  const inputEpisodeId = (() => {
    const data = parsed.data
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
        details: {
          prerequisite: 'episodeId',
          required: 'required',
          actual: null,
        },
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
        details: {
          prerequisite: 'episodeId',
          required: 'forbidden',
          actual: effectiveEpisodeId,
          source: contextEpisodeId ? 'context' : 'input',
        },
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
        details: {
          approval: 'ai-sdk-tool-approval',
        },
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
    }, parsed.data)
  } catch (error) {
    return {
      ok: false,
      error: buildToolError({
        code: 'OPERATION_EXECUTION_FAILED',
        message: toMessage(error),
        operationId: params.operationId,
        details: error instanceof Error && error.cause
          ? { cause: error.cause }
          : null,
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
