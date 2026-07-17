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
import { normalizeProjectAgentToolInput } from '@/lib/operations/tool-input-schema'
import type {
  OperationAgentFlow,
  ProjectAgentOperationTaskBatchBinding,
  ProjectAgentOperationDefinition,
  ProjectAgentOperationOutcome,
  ProjectAgentTaskSubmissionReceipt,
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
import {
  buildProjectAgentOperationTargetKey,
  enforceProjectAgentOperationRunBudget,
} from './run-budget'
import type { ProjectAgentContext, ProjectAgentActivityPartData, ProjectAgentOperationStartPartData } from './types'
import type { ProjectAgentRunFence } from './run-fence'
import {
  type ProjectAgentOperationExecutionFence,
} from './operation-execution-fence'
import {
  bindProjectAgentOperationBatchWaitMemberInTransaction,
} from './waits'
import type { ProjectAgentOperationBatchCoordinator } from './operation-batch'

type UnknownObject = { [key: string]: unknown }

function isRecord(value: unknown): value is UnknownObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
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
  operationBatch: ProjectAgentOperationBatchCoordinator
  writer: UIMessageStreamWriter<UIMessage>
  /** Called exactly once after an execution attempt with its typed outcome. */
  onExecutionSettled?: (settlement: {
    toolCallId: string | null
    outcome: ProjectAgentOperationOutcome
  }) => void
  onToolCallIdentified?: (identity: {
    toolCallId: string
    operationId: string
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
  const identifyToolCall = (toolCallId: string | null | undefined): string | null => {
    const normalizedToolCallId = toolCallId?.trim() || null
    if (normalizedToolCallId) {
      params.onToolCallIdentified?.({
        toolCallId: normalizedToolCallId,
        operationId: params.operation.id,
      })
    }
    return normalizedToolCallId
  }
  const needsApproval = async (_runContext: unknown, toolInput: unknown, toolCallId?: string): Promise<boolean> => {
    if (!requiresApproval) return false
    const identifiedToolCallId = identifyToolCall(toolCallId)
    if (!identifiedToolCallId) {
      throw new Error(`PROJECT_AGENT_TOOL_CALL_ID_MISSING:${params.operation.id}`)
    }
    if (!params.approvalPreflightStore) return true
    return await preflightProjectAgentToolApproval({
      request: params.request,
      operation: params.operation,
      projectId: params.projectId,
      userId: params.userId,
      context: params.context,
      source: 'assistant-panel',
      input: toolInput,
      toolCallId: identifiedToolCallId,
      store: params.approvalPreflightStore,
    })
  }

  return tool({
    name: params.operation.id,
    description: params.description,
    parameters: params.operation.toolInputSchema as never,
    strict: true,
    ...(requiresApproval ? { needsApproval } : {}),
    execute: async (toolInput: unknown, _runContext: unknown, details: unknown): Promise<ProjectAgentToolResult<unknown>> => {
      let executionSettlementReported = false
      const reportExecutionSettled = (outcome: ProjectAgentOperationOutcome): void => {
        if (executionSettlementReported) return
        executionSettlementReported = true
        params.onExecutionSettled?.({ toolCallId, outcome })
      }
      const toolCallId = identifyToolCall(readToolCallId(details))
      const runId = params.context.runId?.trim() || null
      if (!runId) throw new Error('PROJECT_AGENT_OPERATION_RUN_ID_REQUIRED')
      const normalizedInput = normalizeProjectAgentToolInput({
        input: toolInput,
        inputSchema: params.operation.inputSchema,
        toolInputSchema: params.operation.toolInputSchema,
      })
      const approvalPreflightFailure = params.approvalPreflightStore?.consumeFailed({
        operationId: params.operation.id,
        toolCallId,
        input: normalizedInput,
      }) ?? null
      if (approvalPreflightFailure) {
        if (approvalPreflightFailure.ok) {
          throw new Error(`PROJECT_AGENT_APPROVAL_PREFLIGHT_FAILURE_INVALID:${params.operation.id}`)
        }
        reportExecutionSettled({ kind: 'failed', error: approvalPreflightFailure.error })
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
          if (budgetFailure.ok) {
            throw new Error(`PROJECT_AGENT_OPERATION_BUDGET_FAILURE_INVALID:${params.operation.id}`)
          }
          reportExecutionSettled({ kind: 'failed', error: budgetFailure.error })
          return budgetFailure
        }
      }
      const createTaskBatchBinding = (): ProjectAgentOperationTaskBatchBinding => {
        let bound = false
        let committed = false
        let boundBatch: {
          toolCallId: string
          operationId: string
          taskIds: readonly string[]
          receipt: ProjectAgentTaskSubmissionReceipt
          backgroundRunFence: ProjectAgentRunFence
        } | null = null
        return {
          async bindInTransaction(transaction, batch) {
            if (bound) throw new Error(`PROJECT_AGENT_TASK_BATCH_ALREADY_BOUND:${params.operation.id}`)
            if (batch.operationId !== params.operation.id) {
              throw new Error(`PROJECT_AGENT_TASK_BATCH_OPERATION_MISMATCH:${batch.operationId}:${params.operation.id}`)
            }
            if (!toolCallId) throw new Error(`PROJECT_AGENT_OPERATION_BATCH_TOOL_CALL_REQUIRED:${params.operation.id}`)
            const taskIds = Array.from(new Set(batch.taskIds.map((taskId) => taskId.trim()).filter(Boolean))).sort()
            if (taskIds.length === 0) throw new Error(`PROJECT_AGENT_TASK_BATCH_EMPTY:${params.operation.id}`)
            const operationBatch = params.operationBatch.claim(params.operation.id)
            const backgroundRunFence = params.operationBatch.readRunFence()
            const result = await bindProjectAgentOperationBatchWaitMemberInTransaction(transaction, {
              batch: operationBatch,
              backgroundRunFence,
              projectId: params.projectId,
              userId: params.userId,
              episodeId: params.context.episodeId ?? null,
              locale: params.context.locale ?? null,
              assistantId: 'workspace-command',
              operationId: params.operation.id,
              toolCallId,
              taskIds,
            })
            bound = true
            boundBatch = {
              toolCallId,
              operationId: params.operation.id,
              taskIds,
              receipt: result.receipt,
              backgroundRunFence: result.backgroundRunFence,
            }
            return result.receipt
          },
          isBound() {
            return bound
          },
          markCommitted() {
            if (!bound || !boundBatch) return
            committed = true
            params.operationBatch.commitMember({
              ...boundBatch,
              runFence: boundBatch.backgroundRunFence,
            })
          },
          isCommitted() {
            return committed
          },
          getCommittedReceipt() {
            return committed ? boundBatch?.receipt ?? null : null
          },
        }
      }
      if (isSuspendingOperation(params.operation.agentFlow)) {
        const taskBatchBinding = createTaskBatchBinding()
        const executionFence: ProjectAgentOperationExecutionFence = {
          runFence: params.runFence,
          signal: params.operationSignal,
          continuationClaim: params.continuationClaim ?? null,
          taskBatchBinding,
          concurrentExecutionSegmentId: params.context.executionSegmentId ?? null,
        }
        try {
          const execution = await executeProjectAgentOperationFromTool({
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
          reportExecutionSettled(execution.outcome)
          return execution.result
        } catch (error) {
          reportExecutionSettled({
            kind: 'failed',
            error: buildToolError({
              code: 'OPERATION_EXECUTION_FAILED',
              message: error instanceof Error ? error.message : String(error),
              operationId: params.operation.id,
            }),
          })
          throw error
        }
      }
      const operationActivityId = randomUUID()
      const taskBatchBinding = createTaskBatchBinding()
      const executionFence: ProjectAgentOperationExecutionFence = {
        runFence: params.runFence,
        signal: params.operationSignal,
        continuationClaim: params.continuationClaim ?? null,
        taskBatchBinding,
        concurrentExecutionSegmentId: params.context.executionSegmentId ?? null,
      }
      const startedActivity = operationActivityId ? await appendProjectAgentEvents({
        scope: {
          projectId: params.projectId,
          userId: params.userId,
          episodeId: params.context.episodeId ?? null,
          assistantId: 'workspace-command',
        },
        events: [
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
      }) : null
      if (startedActivity) writeActivityDataPart(params.writer, startedActivity)
      if (params.operation.intent === 'act') {
        writeOperationDataPart<ProjectAgentOperationStartPartData>(params.writer, 'data-agent-operation-start', {
          runId,
          operationId: params.operation.id,
          ...(toolCallId ? { toolCallId } : {}),
        })
      }
      try {
        const execution = await executeProjectAgentOperationFromTool({
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
        const result = execution.result
        const settledActivity = !operationActivityId ? null : await appendProjectAgentEvents({
          scope: {
            projectId: params.projectId,
            userId: params.userId,
            episodeId: params.context.episodeId ?? null,
            assistantId: 'workspace-command',
          },
          events: [{
            runFence: params.runFence,
            idempotencyKey: execution.outcome.kind !== 'failed'
              ? `activity-completed:${operationActivityId}`
              : `activity-failed:${operationActivityId}:${execution.outcome.error.code}`,
            event: execution.outcome.kind !== 'failed'
              ? {
                  kind: 'activity.completed',
                  runId,
                  activityId: operationActivityId,
                }
              : {
                  kind: 'activity.failed',
                  runId,
                  activityId: operationActivityId,
                  errorCode: execution.outcome.error.code,
                  errorMessage: execution.outcome.error.message,
                },
          }],
        })
        if (settledActivity) writeActivityDataPart(params.writer, settledActivity)
        reportExecutionSettled(execution.outcome)
        return result
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        const failedActivity = operationActivityId ? await appendProjectAgentEvents({
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
        }) : null
        if (failedActivity) writeActivityDataPart(params.writer, failedActivity)
        reportExecutionSettled({
          kind: 'failed',
          error: buildToolError({
            code: 'OPERATION_EXECUTION_FAILED',
            message: errorMessage,
            operationId: params.operation.id,
          }),
        })
        throw error
      }
    },
  })
}
