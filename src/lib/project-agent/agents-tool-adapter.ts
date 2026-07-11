import type { UIMessage, UIMessageStreamWriter } from 'ai'
import { randomUUID } from 'node:crypto'
import {
  tool,
  type Tool,
} from '@openai/agents'
import type { NextRequest } from 'next/server'
import { buildToolError } from '@/lib/adapters/operation-error-normalizer'
import { executeProjectAgentOperationFromTool } from '@/lib/adapters/tools/execute-project-agent-operation'
import { writeOperationDataPart } from '@/lib/operations/types'
import type {
  OperationAgentFlow,
  ProjectAgentOperationTaskBatchBinding,
  ProjectAgentOperationDefinition,
  ProjectAgentToolResult,
} from '@/lib/operations/types'
import {
  shouldRequireAssistantToolApproval,
  type AssistantPermissionMode,
} from './permission-mode'
import {
  preflightProjectAgentToolApproval,
  type ProjectAgentApprovalPreflightStore,
} from './approval-preflight'
import { appendProjectAgentEvents, type ProjectAgentActivitySnapshot } from './event'
import { normalizeOperationRuntimeSignal } from './runtime-signal'
import {
  buildProjectAgentOperationTargetKey,
  enforceProjectAgentOperationRunBudget,
} from './run-budget'
import type { ProjectAgentContext, ProjectAgentActivityPartData, ProjectAgentOperationStartPartData } from './types'
import type { ProjectAgentRunFence } from './run-fence'
import {
  recordProjectAgentSuspensionReceipt,
  type ProjectAgentOperationExecutionFence,
} from './operation-execution-fence'
import type {
  ProjectAgentSuspensionReceipt,
  ProjectAgentTaskSuspensionReceipt,
} from './suspension'
import { bindProjectAgentWaitToTasksInTransaction } from './waits'

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

function isSuspendingOperation(agentFlow: OperationAgentFlow | undefined): boolean {
  return agentFlow?.suspendsFor === 'choice'
}

function isNoopToolResult(result: ProjectAgentToolResult<unknown>): boolean {
  return result.ok && isRecord(result.data) && result.data.noop === true
}

function enforceLongRunningTaskSignal(
  operation: ProjectAgentOperationDefinition,
  result: ProjectAgentToolResult<unknown>,
): ProjectAgentToolResult<unknown> {
  if (!result.ok || !operation.effects.longRunning) return result
  const signal = normalizeOperationRuntimeSignal({
    toolName: operation.id,
    output: result,
  })
  if (signal.kind === 'await_task' || isNoopToolResult(result)) return result
  return {
    ok: false,
    error: buildToolError({
      code: 'OPERATION_OUTPUT_INVALID',
      message: 'PROJECT_AGENT_ASYNC_TASK_SIGNAL_MISSING',
      operationId: operation.id,
      details: {
        expected: 'async_task_signal',
        reasonCode: 'PROJECT_AGENT_ASYNC_TASK_SIGNAL_MISSING',
      },
    }),
  }
}

export interface CreateProjectAgentOperationToolParams {
  request: NextRequest
  operation: ProjectAgentOperationDefinition
  description: string
  projectId: string
  userId: string
  context: ProjectAgentContext
  runFence: ProjectAgentRunFence
  operationSignal: AbortSignal
  continuationClaim?: ProjectAgentOperationExecutionFence['continuationClaim']
  assistantPermissionMode: AssistantPermissionMode
  writer: UIMessageStreamWriter<UIMessage>
  /**
   * Live availability predicate, re-evaluated by the Agents SDK before every
   * model turn. Omit for tools that are always available.
   */
  isEnabled?: () => Promise<boolean>
  /** Called exactly once after an execution attempt with its real outcome. */
  onExecutionSettled?: (outcome: { ok: boolean; suspension: ProjectAgentSuspensionReceipt | null }) => void
  onTaskBatchBound?: (batch: {
    operationId: string
    taskIds: readonly string[]
    suspension: ProjectAgentTaskSuspensionReceipt
  }) => void
  approvalPreflightStore?: ProjectAgentApprovalPreflightStore
}

export function createProjectAgentOperationTool(
  params: CreateProjectAgentOperationToolParams,
): Tool {
  const requiresApproval = shouldRequireAssistantToolApproval({
    mode: params.assistantPermissionMode,
    operation: params.operation,
  })
  const needsApproval = async (_runContext: unknown, toolInput: unknown, toolCallId?: string): Promise<boolean> => {
    if (!requiresApproval) return false
    if (!params.approvalPreflightStore) return true
    return await preflightProjectAgentToolApproval({
      request: params.request,
      operation: params.operation,
      projectId: params.projectId,
      userId: params.userId,
      context: params.context,
      source: 'assistant-panel',
      input: normalizeToolInputForExecution(toolInput),
      toolCallId,
      store: params.approvalPreflightStore,
    })
  }

  return tool({
    name: params.operation.id,
    description: params.description,
    parameters: params.operation.toolInputSchema as never,
    strict: true,
    ...(requiresApproval ? { needsApproval } : {}),
    ...(params.isEnabled ? { isEnabled: params.isEnabled } : {}),
    execute: async (toolInput: unknown, _runContext: unknown, details: unknown): Promise<ProjectAgentToolResult<unknown>> => {
      let executionSettlementReported = false
      const reportExecutionSettled = (
        ok: boolean,
        suspension: ProjectAgentSuspensionReceipt | null = null,
      ): void => {
        if (executionSettlementReported) return
        executionSettlementReported = true
        params.onExecutionSettled?.({ ok, suspension })
      }
      const toolCallId = readToolCallId(details)
      const runId = params.context.runId?.trim() || null
      if (!runId) throw new Error('PROJECT_AGENT_OPERATION_RUN_ID_REQUIRED')
      const normalizedInput = normalizeToolInputForExecution(toolInput)
      const approvalPreflightFailure = params.approvalPreflightStore?.consumeFailed({
        operationId: params.operation.id,
        toolCallId,
        input: normalizeToolInputForExecution(toolInput),
      }) ?? null
      if (approvalPreflightFailure) {
        reportExecutionSettled(false)
        return approvalPreflightFailure
      }
      const operationTargetKey = buildProjectAgentOperationTargetKey({
        operationId: params.operation.id,
        projectId: params.projectId,
        context: params.context,
        toolInput: normalizedInput,
      })
      if (params.operation.intent === 'act' && !isSuspendingOperation(params.operation.agentFlow)) {
        const budgetFailure = await enforceProjectAgentOperationRunBudget({
          projectId: params.projectId,
          userId: params.userId,
          runId,
          operationId: params.operation.id,
          targetKey: operationTargetKey,
        })
        if (budgetFailure) {
          reportExecutionSettled(false)
          return budgetFailure
        }
      }
      const createTaskBatchBinding = (previousActivityId: string | null): ProjectAgentOperationTaskBatchBinding => {
        let bound = false
        let committed = false
        let boundBatch: {
          operationId: string
          taskIds: readonly string[]
          suspension: ProjectAgentTaskSuspensionReceipt
        } | null = null
        return {
          async bindInTransaction(transaction, batch) {
            if (bound) throw new Error(`PROJECT_AGENT_TASK_BATCH_ALREADY_BOUND:${params.operation.id}`)
            if (batch.operationId !== params.operation.id) {
              throw new Error(`PROJECT_AGENT_TASK_BATCH_OPERATION_MISMATCH:${batch.operationId}:${params.operation.id}`)
            }
            const taskIds = Array.from(new Set(batch.taskIds.map((taskId) => taskId.trim()).filter(Boolean))).sort()
            if (taskIds.length === 0) throw new Error(`PROJECT_AGENT_TASK_BATCH_EMPTY:${params.operation.id}`)
            const suspension = await bindProjectAgentWaitToTasksInTransaction(transaction, {
              runFence: params.runFence,
              runId,
              projectId: params.projectId,
              userId: params.userId,
              episodeId: params.context.episodeId ?? null,
              assistantId: 'workspace-command',
              operationId: params.operation.id,
              taskIds,
              followUpMode: params.operation.agentFlow?.onTaskComplete === 'complete' ? 'complete' : 'resume_agent',
              previousActivityId,
            })
            if (!suspension) throw new Error(`PROJECT_AGENT_WAIT_BINDING_FAILED:${params.operation.id}`)
            bound = true
            boundBatch = { operationId: params.operation.id, taskIds, suspension }
            return suspension
          },
          isBound() {
            return bound
          },
          markCommitted() {
            if (!bound || !boundBatch) return
            committed = true
            recordProjectAgentSuspensionReceipt(boundBatch.suspension)
            params.onTaskBatchBound?.(boundBatch)
          },
          isCommitted() {
            return committed
          },
        }
      }
      if (isSuspendingOperation(params.operation.agentFlow)) {
        const taskBatchBinding = createTaskBatchBinding(null)
        const executionFence: ProjectAgentOperationExecutionFence = {
          runFence: params.runFence,
          signal: params.operationSignal,
          continuationClaim: params.continuationClaim ?? null,
          taskBatchBinding,
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
            input: normalizedInput,
            toolCallId,
            executionFence,
            taskBatchBinding,
          })
          const enforcedResult = enforceLongRunningTaskSignal(params.operation, result)
          reportExecutionSettled(enforcedResult.ok, executionFence.suspensionReceipt ?? null)
          return enforcedResult
        } catch (error) {
          reportExecutionSettled(false)
          throw error
        }
      }
      const operationActivityId = randomUUID()
      const taskBatchBinding = createTaskBatchBinding(operationActivityId)
      const executionFence: ProjectAgentOperationExecutionFence = {
        runFence: params.runFence,
        signal: params.operationSignal,
        continuationClaim: params.continuationClaim ?? null,
        taskBatchBinding,
      }
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
                runFence: params.runFence,
                idempotencyKey: `activity-completed:${params.context.currentActivityId}:before:${operationActivityId}`,
                event: {
                  kind: 'activity.completed' as const,
                  runId,
                  activityId: params.context.currentActivityId,
                },
              }]
            : []),
          {
            runFence: params.runFence,
            idempotencyKey: `activity-started:${operationActivityId}`,
            event: {
              kind: 'activity.started',
              runId,
              activityId: operationActivityId,
              type: 'operation',
              operationId: params.operation.id,
              targetKey: operationTargetKey,
              ...(toolCallId ? { toolCallId } : {}),
            },
          },
        ],
      })
      if (startedActivity) writeActivityDataPart(params.writer, startedActivity)
      if (params.operation.intent === 'act') {
        writeOperationDataPart<ProjectAgentOperationStartPartData>(params.writer, 'data-agent-operation-start', {
          runId,
          operationId: params.operation.id,
          ...(toolCallId ? { toolCallId } : {}),
        })
      }
      try {
        const rawResult = await executeProjectAgentOperationFromTool({
          request: params.request,
          operationId: params.operation.id,
          projectId: params.projectId,
          userId: params.userId,
          context: params.context,
          assistantPermissionMode: params.assistantPermissionMode,
          source: 'assistant-panel',
          writer: params.writer,
          input: normalizedInput,
          toolCallId,
          executionFence,
          taskBatchBinding,
        })
        const result = enforceLongRunningTaskSignal(params.operation, rawResult)
        const settledActivity = taskBatchBinding.isCommitted() ? null : await appendProjectAgentEvents({
          scope: {
            projectId: params.projectId,
            userId: params.userId,
            episodeId: params.context.episodeId ?? null,
            assistantId: 'workspace-command',
          },
          events: [{
            runFence: params.runFence,
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
        reportExecutionSettled(result.ok, executionFence.suspensionReceipt ?? null)
        return result
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        const failedActivity = await appendProjectAgentEvents({
          scope: {
            projectId: params.projectId,
            userId: params.userId,
            episodeId: params.context.episodeId ?? null,
            assistantId: 'workspace-command',
          },
          events: [{
            runFence: params.runFence,
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
        reportExecutionSettled(false)
        throw error
      }
    },
  })
}
