import type { UIMessage, UIMessageStreamWriter } from 'ai'
import { randomUUID } from 'node:crypto'
import {
  tool,
  type Tool,
} from '@openai/agents'
import type { NextRequest } from 'next/server'
import { executeProjectAgentOperationFromTool } from '@/lib/adapters/tools/execute-project-agent-operation'
import { isConfirmedOperationInput } from '@/lib/operations/confirmation'
import { writeOperationDataPart } from '@/lib/operations/types'
import type {
  ProjectAgentOperationDefinition,
  ProjectAgentToolResult,
} from '@/lib/operations/types'
import {
  shouldRequireAssistantToolApproval,
  type AssistantPermissionMode,
} from './permission-mode'
import { appendProjectAgentEvents, type ProjectAgentActivitySnapshot } from './event'
import type { ProjectAgentContext, ProjectAgentActivityPartData, ProjectAgentOperationStartPartData } from './types'

type UnknownObject = { [key: string]: unknown }

function isRecord(value: unknown): value is UnknownObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeToolInputForExecution(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeToolInputForExecution)
  }
  if (!isRecord(value)) return value
  const out: UnknownObject = {}
  for (const [key, child] of Object.entries(value)) {
    if (child === null) continue
    out[key] = normalizeToolInputForExecution(child)
  }
  return out
}

function injectConfirmedInput(input: unknown, requiresApproval: boolean): unknown {
  if (!requiresApproval || isConfirmedOperationInput(input)) return input
  if (isRecord(input)) {
    return {
      ...input,
      confirmed: true,
    }
  }
  return {
    value: input,
    confirmed: true,
  }
}

function readToolCallId(details: unknown): string | null {
  if (!isRecord(details)) return null
  const toolCall = details.toolCall
  if (!isRecord(toolCall)) return null
  const callId = toolCall.callId
  if (typeof callId === 'string' && callId.trim()) return callId.trim()
  const id = toolCall.id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

function writeActivityDataPart(
  writer: UIMessageStreamWriter<UIMessage>,
  activity: ProjectAgentActivitySnapshot,
): void {
  writeOperationDataPart<ProjectAgentActivityPartData>(writer, 'data-agent-activity', {
    activityId: activity.activityId,
    runId: activity.runId,
    type: activity.type,
    status: activity.status,
    operationId: activity.operationId,
    sourceOperationId: activity.sourceOperationId,
    toolCallId: activity.toolCallId,
    choiceType: activity.choiceType,
  })
}

export interface CreateProjectAgentOperationToolParams {
  request: NextRequest
  operation: ProjectAgentOperationDefinition
  description: string
  projectId: string
  userId: string
  context: ProjectAgentContext
  assistantPermissionMode: AssistantPermissionMode
  writer: UIMessageStreamWriter<UIMessage>
  /**
   * Live availability predicate, re-evaluated by the Agents SDK before every
   * model turn. Omit for tools that are always available.
   */
  isEnabled?: () => Promise<boolean>
  /**
   * Called after every execution attempt (success or failure). The runtime
   * uses it to invalidate its cached workflow state so the next turn's
   * isEnabled evaluations see the post-execution project state.
   */
  onExecutionSettled?: () => void
}

export function createProjectAgentOperationTool(
  params: CreateProjectAgentOperationToolParams,
): Tool {
  const requiresApproval = shouldRequireAssistantToolApproval({
    mode: params.assistantPermissionMode,
    operation: params.operation,
  })

  return tool({
    name: params.operation.id,
    description: params.description,
    parameters: params.operation.toolInputSchema as never,
    strict: true,
    ...(requiresApproval ? { needsApproval: true } : {}),
    ...(params.isEnabled ? { isEnabled: params.isEnabled } : {}),
    execute: async (toolInput: unknown, _runContext: unknown, details: unknown): Promise<ProjectAgentToolResult<unknown>> => {
      const toolCallId = readToolCallId(details)
      const runId = params.context.runId?.trim() || null
      let operationActivityId: string | null = null
      if (params.operation.intent === 'act') {
        if (!runId) throw new Error('PROJECT_AGENT_OPERATION_RUN_ID_REQUIRED')
        const activityId = randomUUID()
        operationActivityId = activityId
        const startedActivity = await appendProjectAgentEvents({
          scope: {
            projectId: params.projectId,
            userId: params.userId,
            episodeId: params.context.episodeId ?? null,
            assistantId: 'workspace-command',
          },
          events: [
            ...(params.context.currentActivityId
              ? [{
                  idempotencyKey: `activity-completed:${params.context.currentActivityId}:before:${activityId}`,
                  event: {
                    kind: 'activity.completed' as const,
                    runId,
                    activityId: params.context.currentActivityId,
                  },
                }]
              : []),
            {
              idempotencyKey: `activity-started:${activityId}`,
              event: {
                kind: 'activity.started',
                runId,
                activityId,
                type: 'operation',
                operationId: params.operation.id,
                ...(toolCallId ? { toolCallId } : {}),
              },
            },
          ],
        })
        if (startedActivity) writeActivityDataPart(params.writer, startedActivity)
        writeOperationDataPart<ProjectAgentOperationStartPartData>(params.writer, 'data-agent-operation-start', {
          runId,
          operationId: params.operation.id,
          ...(toolCallId ? { toolCallId } : {}),
        })
      }
      try {
        const result = await executeProjectAgentOperationFromTool({
          request: params.request,
          operationId: params.operation.id,
          projectId: params.projectId,
          userId: params.userId,
          context: params.context,
          assistantPermissionMode: params.assistantPermissionMode,
          source: 'assistant-panel',
          writer: params.writer,
          input: injectConfirmedInput(normalizeToolInputForExecution(toolInput), requiresApproval),
          toolCallId,
        })
        if (operationActivityId && runId) {
          const settledActivity = await appendProjectAgentEvents({
            scope: {
              projectId: params.projectId,
              userId: params.userId,
              episodeId: params.context.episodeId ?? null,
              assistantId: 'workspace-command',
            },
            events: [{
              idempotencyKey: result.ok
                ? `activity-completed:${operationActivityId}`
                : `activity-failed:${operationActivityId}:${result.error.code}`,
              event: result.ok
                ? {
                    kind: 'activity.completed',
                    runId,
                    activityId: operationActivityId,
                  }
                : {
                    kind: 'activity.failed',
                    runId,
                    activityId: operationActivityId,
                    errorCode: result.error.code,
                    errorMessage: result.error.message,
                  },
            }],
          })
          if (settledActivity) writeActivityDataPart(params.writer, settledActivity)
        }
        return result
      } catch (error) {
        if (operationActivityId && runId) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          const failedActivity = await appendProjectAgentEvents({
            scope: {
              projectId: params.projectId,
              userId: params.userId,
              episodeId: params.context.episodeId ?? null,
              assistantId: 'workspace-command',
            },
            events: [{
              idempotencyKey: `activity-failed:${operationActivityId}:throw`,
              event: {
                kind: 'activity.failed',
                runId,
                activityId: operationActivityId,
                errorCode: 'PROJECT_AGENT_OPERATION_THROWN',
                errorMessage,
              },
            }],
          })
          if (failedActivity) writeActivityDataPart(params.writer, failedActivity)
        }
        throw error
      } finally {
        params.onExecutionSettled?.()
      }
    },
  })
}
