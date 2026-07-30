import type { UIMessage, UIMessageStreamWriter } from 'ai'
import { randomUUID } from 'node:crypto'
import {
  tool,
  type RunContext,
  type Tool,
} from '@openai/agents'
import type { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-errors'
import { buildToolError, normalizeOperationExecutionToolError } from '@/lib/adapters/operation-error-normalizer'
import { executeProjectAgentOperationFromTool } from '@/lib/adapters/tools/execute-project-agent-operation'
import { writeOperationDataPart } from '@/lib/operations/types'
import { normalizeProjectAgentToolInput } from '@/lib/operations/tool-input-schema'
import { loadApprovedOperationExecutionInput } from '@/lib/operations/planned-operation-invocation'
import type {
  OperationAgentFlow,
  ProjectAgentOperationRegistry,
  ProjectAgentOperationTaskBatchBinding,
  ProjectAgentOperationDefinition,
  ProjectAgentOperationOutcome,
  ProjectAgentTaskSubmissionReceipt,
  ProjectAgentToolInputSchema,
  ProjectAgentToolResult,
} from '@/lib/operations/types'
import {
  type ProjectAgentResolvedToolContract,
  PROJECT_AGENT_OPERATION_GATEWAY_NAME,
  type ProjectAgentToolDiscoveryState,
} from './tool-discovery'
import { shouldRequireInteractiveToolApproval } from './tool-approval-policy'
import {
  authorizeProjectAgentToolAutomatically,
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
  })
}

function isSuspendingOperation(agentFlow: OperationAgentFlow | undefined): boolean {
  return agentFlow?.suspendsFor === 'choice'
}

export interface CreateProjectAgentOperationToolsParams {
  request: NextRequest
  registry: ProjectAgentOperationRegistry
  discoveryState: ProjectAgentToolDiscoveryState
  description: string
  directOperations: readonly {
    operation: ProjectAgentOperationDefinition
    description: string
  }[]
  projectId: string
  userId: string
  context: ProjectAgentContext
  runFence: ProjectAgentRunFence
  operationSignal: AbortSignal
  continuationClaim?: ProjectAgentOperationExecutionFence['continuationClaim']
  billingConfirmationRequired: boolean
  operationBatch: ProjectAgentOperationBatchCoordinator
  writer: UIMessageStreamWriter<UIMessage>
  /** Called exactly once after an execution attempt with its typed outcome. */
  onExecutionSettled?: (settlement: {
    toolCallId: string | null
    operationId: string
    outcome: ProjectAgentOperationOutcome
  }) => void
  onToolCallIdentified?: (identity: {
    toolCallId: string
    operationId: string
  }) => void
  approvalPreflightStore?: ProjectAgentApprovalPreflightStore
}

interface ProjectAgentOperationGatewayInputBase {
  readonly operationId: string
  readonly arguments: Record<string, unknown>
}

export type ProjectAgentOperationGatewayInput =
  | (ProjectAgentOperationGatewayInputBase & {
    readonly kind: 'static'
  })
  | (ProjectAgentOperationGatewayInputBase & {
    readonly kind: 'bound'
    readonly contractId: string
  })

export const PROJECT_AGENT_OPERATION_GATEWAY_INPUT_SCHEMA: ProjectAgentToolInputSchema = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: ['static', 'bound'],
      description: 'Exact definition kind returned by load_tools.',
    },
    operationId: {
      type: 'string',
      description: 'Exact loaded Operation id returned by load_tools.',
    },
    contractId: {
      type: 'string',
      description: 'Exact opaque contract id returned beside the loaded Operation.',
    },
    argumentsJson: {
      type: 'string',
      description: 'A JSON object serialized as a string and matching the loaded Operation parameters exactly.',
    },
  },
  required: ['kind', 'operationId', 'argumentsJson'],
  additionalProperties: false,
}

export function readProjectAgentOperationGatewayOperationId(input: unknown): string {
  if (!isRecord(input)) {
    throw new Error('PROJECT_AGENT_OPERATION_GATEWAY_INPUT_INVALID')
  }
  const operationId = typeof input.operationId === 'string' ? input.operationId.trim() : ''
  if (!operationId) {
    throw new Error('PROJECT_AGENT_OPERATION_GATEWAY_OPERATION_ID_REQUIRED')
  }
  return operationId
}

export function resolveProjectAgentOperationGatewayToolIdentity(input: unknown): string {
  try {
    return readProjectAgentOperationGatewayOperationId(input)
  } catch {
    return PROJECT_AGENT_OPERATION_GATEWAY_NAME
  }
}

export function readProjectAgentOperationGatewayInput(
  input: unknown,
): ProjectAgentOperationGatewayInput {
  const operationId = readProjectAgentOperationGatewayOperationId(input)
  if (!isRecord(input)) throw new Error('PROJECT_AGENT_OPERATION_GATEWAY_INPUT_INVALID')
  const kind = input.kind
  if (kind !== 'static' && kind !== 'bound') {
    throw new Error(`PROJECT_AGENT_OPERATION_GATEWAY_KIND_INVALID:${operationId}`)
  }
  if (typeof input.argumentsJson !== 'string' || !input.argumentsJson.trim()) {
    throw new Error(`PROJECT_AGENT_OPERATION_GATEWAY_ARGUMENTS_REQUIRED:${operationId}`)
  }
  let parsedArguments: unknown
  try {
    parsedArguments = JSON.parse(input.argumentsJson)
  } catch {
    throw new Error(`PROJECT_AGENT_OPERATION_GATEWAY_ARGUMENTS_JSON_INVALID:${operationId}`)
  }
  if (!isRecord(parsedArguments)) {
    throw new Error(`PROJECT_AGENT_OPERATION_GATEWAY_ARGUMENTS_OBJECT_REQUIRED:${operationId}`)
  }
  if (kind === 'static') {
    if (input.contractId !== undefined) {
      throw new Error(`PROJECT_AGENT_OPERATION_GATEWAY_STATIC_CONTRACT_FORBIDDEN:${operationId}`)
    }
    return { kind, operationId, arguments: parsedArguments }
  }
  const contractId = typeof input.contractId === 'string' ? input.contractId.trim() : ''
  if (!contractId) {
    throw new Error(`PROJECT_AGENT_OPERATION_GATEWAY_CONTRACT_ID_REQUIRED:${operationId}`)
  }
  return { kind, operationId, contractId, arguments: parsedArguments }
}

export function createProjectAgentOperationTools(
  params: CreateProjectAgentOperationToolsParams,
): Tool[] {
  const directOperationIdByToolCallId = new Map<string, string>()
  const identifyToolCall = (
    toolCallId: string | null | undefined,
    operationId: string,
  ): string | null => {
    const normalizedToolCallId = toolCallId?.trim() || null
    if (normalizedToolCallId) {
      params.onToolCallIdentified?.({
        toolCallId: normalizedToolCallId,
        operationId,
      })
    }
    return normalizedToolCallId
  }
  const resolveOperation = async (
    input: unknown,
    toolCallId?: string | null,
  ): Promise<{
    invocation: ProjectAgentOperationGatewayInput
    operation: ProjectAgentOperationDefinition
    contract: ProjectAgentResolvedToolContract | null
  }> => {
    const invocation = readProjectAgentOperationGatewayInput(input)
    const operation = params.registry[invocation.operationId]
    if (!operation?.channels.tool) {
      throw new Error(`PROJECT_AGENT_OPERATION_GATEWAY_OPERATION_UNKNOWN:${invocation.operationId}`)
    }
    if (
      operation.toolExposure === 'direct'
      && (
        invocation.kind !== 'static'
        || !toolCallId
        || directOperationIdByToolCallId.get(toolCallId) !== operation.id
      )
    ) {
      throw new Error(`PROJECT_AGENT_OPERATION_DIRECT_TOOL_REQUIRED:${invocation.operationId}`)
    }
    if (operation.toolExposure === 'direct') {
      return { invocation, operation, contract: null }
    }
    const expectsBoundContract = Boolean(operation.bindToolInputSchema)
    if (expectsBoundContract !== (invocation.kind === 'bound')) {
      throw new Error(`PROJECT_AGENT_OPERATION_GATEWAY_KIND_MISMATCH:${invocation.operationId}`)
    }
    const persistedApprovedInvocation = toolCallId
      ? params.context.approvedInvocationByToolCallId?.[toolCallId] ?? null
      : null
    if (persistedApprovedInvocation) {
      return { invocation, operation, contract: null }
    }
    if (invocation.kind === 'static') {
      return { invocation, operation, contract: null }
    }
    const contract = await params.discoveryState.resolveContract(
      invocation.operationId,
      invocation.contractId,
    )
    return { invocation, operation, contract }
  }
  const needsApproval = async (_runContext: unknown, toolInput: unknown, toolCallId?: string): Promise<boolean> => {
    let resolved: Awaited<ReturnType<typeof resolveOperation>>
    try {
      resolved = await resolveOperation(toolInput, toolCallId)
    } catch {
      return false
    }
    const { invocation, operation, contract } = resolved
    const requiresApproval = shouldRequireInteractiveToolApproval({
      operation,
      billingConfirmationRequired: params.billingConfirmationRequired,
    })
    const identifiedToolCallId = identifyToolCall(toolCallId, operation.id)
    if (!requiresApproval) return false
    if (
      identifiedToolCallId
      && params.context.approvedInvocationByToolCallId?.[identifiedToolCallId]
    ) {
      // The persisted grant already settles this Tool call; execution reads
      // the approved input snapshot instead of running another preflight.
      return false
    }
    if (!identifiedToolCallId) {
      throw new Error(`PROJECT_AGENT_TOOL_CALL_ID_MISSING:${operation.id}`)
    }
    if (!params.approvalPreflightStore) return true
    let normalizedInput: unknown
    try {
      normalizedInput = normalizeProjectAgentToolInput({
        operationId: operation.id,
        input: invocation.arguments,
        inputSchema: contract?.inputSchema ?? operation.inputSchema,
        toolInputSchema: contract?.toolInputSchema ?? operation.toolInputSchema,
      })
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      // Invalid input never earns an approval card; execution re-raises the
      // same typed normalization error as the tool result.
      return false
    }
    return await preflightProjectAgentToolApproval({
      request: params.request,
      operation,
      projectId: params.projectId,
      userId: params.userId,
      context: params.context,
      source: 'assistant-panel',
      input: normalizedInput,
      boundToolContractState: contract?.state,
      toolCallId: identifiedToolCallId,
      store: params.approvalPreflightStore,
    })
  }

  const gatewayTool = tool({
    name: PROJECT_AGENT_OPERATION_GATEWAY_NAME,
    description: params.description,
    parameters: PROJECT_AGENT_OPERATION_GATEWAY_INPUT_SCHEMA as never,
    strict: false,
    needsApproval,
    execute: async (toolInput: unknown, _runContext: unknown, details: unknown): Promise<ProjectAgentToolResult<unknown>> => {
      const rawToolCallId = readToolCallId(details)
      let resolved: Awaited<ReturnType<typeof resolveOperation>>
      try {
        resolved = await resolveOperation(toolInput, rawToolCallId)
      } catch (error) {
        const operationId = resolveProjectAgentOperationGatewayToolIdentity(toolInput)
        const toolCallId = identifyToolCall(rawToolCallId, operationId)
        const outcome: ProjectAgentOperationOutcome = {
          kind: 'failed',
          error: buildToolError({
            code: error instanceof Error
              && error.message.startsWith('PROJECT_AGENT_OPERATION_CONTRACT_STALE:')
              ? 'OPERATION_CONTRACT_STALE'
              : 'OPERATION_INPUT_INVALID',
            message: error instanceof Error ? error.message : String(error),
            operationId,
          }),
        }
        params.onExecutionSettled?.({ toolCallId, operationId, outcome })
        return { ok: false, error: outcome.error }
      }
      const { invocation, operation, contract } = resolved
      const automaticallyAuthorizeBilling = operation.confirmation.kind === 'billable_media'
        && !params.billingConfirmationRequired
      let executionSettlementReported = false
      const reportExecutionSettled = (outcome: ProjectAgentOperationOutcome): void => {
        if (executionSettlementReported) return
        executionSettlementReported = true
        params.onExecutionSettled?.({ toolCallId, operationId: operation.id, outcome })
      }
      const toolCallId = identifyToolCall(rawToolCallId, operation.id)
      const runId = params.context.runId?.trim() || null
      if (!runId) throw new Error('PROJECT_AGENT_OPERATION_RUN_ID_REQUIRED')
      const persistedApprovedInvocation = toolCallId
        ? params.context.approvedInvocationByToolCallId?.[toolCallId] ?? null
        : null
      let normalizedInput: unknown
      if (persistedApprovedInvocation) {
        // An approved invocation executes the exact input snapshot that was
        // normalized, priced, and granted at preflight; re-normalizing the
        // model's original arguments on resume is forbidden.
        try {
          normalizedInput = await loadApprovedOperationExecutionInput({
            userId: params.userId,
            operationId: operation.id,
            invocation: persistedApprovedInvocation,
          })
        } catch (error) {
          const toolError = normalizeOperationExecutionToolError({
            error,
            operation,
            operationId: operation.id,
          })
          reportExecutionSettled({ kind: 'failed', error: toolError })
          return { ok: false, error: toolError }
        }
      } else {
        try {
          normalizedInput = normalizeProjectAgentToolInput({
            operationId: operation.id,
            input: invocation.arguments,
            inputSchema: contract?.inputSchema ?? operation.inputSchema,
            toolInputSchema: contract?.toolInputSchema ?? operation.toolInputSchema,
          })
        } catch (error) {
          if (!(error instanceof ApiError)) throw error
          // Un-normalizable input still flows to the single invocation
          // authority, which re-raises the same typed OPERATION_INPUT_INVALID
          // through its established error mapping; only the raw arguments the
          // model actually sent are used for the keys and budget below.
          normalizedInput = invocation.arguments
        }
      }
      const approvalPreflightFailure = params.approvalPreflightStore?.consumeFailed({
        operationId: operation.id,
        toolCallId,
        input: normalizedInput,
      }) ?? null
      if (approvalPreflightFailure) {
        if (approvalPreflightFailure.ok) {
          throw new Error(`PROJECT_AGENT_APPROVAL_PREFLIGHT_FAILURE_INVALID:${operation.id}`)
        }
        reportExecutionSettled({ kind: 'failed', error: approvalPreflightFailure.error })
        return approvalPreflightFailure
      }
      const operationTargetKey = buildProjectAgentOperationTargetKey({
        operationId: operation.id,
        projectId: params.projectId,
        context: params.context,
        toolInput: normalizedInput,
      })
      if (operation.intent === 'act' && !isSuspendingOperation(operation.agentFlow)) {
        const budgetFailure = await enforceProjectAgentOperationRunBudget({
          projectId: params.projectId,
          userId: params.userId,
          runId,
          operationId: operation.id,
          targetKey: operationTargetKey,
        })
        if (budgetFailure) {
          if (budgetFailure.ok) {
            throw new Error(`PROJECT_AGENT_OPERATION_BUDGET_FAILURE_INVALID:${operation.id}`)
          }
          reportExecutionSettled({ kind: 'failed', error: budgetFailure.error })
          return budgetFailure
        }
      }
      let automaticApprovedInvocation = null
      if (automaticallyAuthorizeBilling && !persistedApprovedInvocation) {
        if (!toolCallId) {
          throw new Error(`PROJECT_AGENT_TOOL_CALL_ID_MISSING:${operation.id}`)
        }
        try {
          automaticApprovedInvocation = await authorizeProjectAgentToolAutomatically({
            request: params.request,
            operation,
            projectId: params.projectId,
            userId: params.userId,
            context: params.context,
            source: 'assistant-panel',
            input: normalizedInput,
            boundToolContractState: contract?.state,
            toolCallId,
          })
        } catch (error) {
          const toolError = normalizeOperationExecutionToolError({
            error,
            operation,
            operationId: operation.id,
          })
          reportExecutionSettled({ kind: 'failed', error: toolError })
          return { ok: false, error: toolError }
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
            if (bound) throw new Error(`PROJECT_AGENT_TASK_BATCH_ALREADY_BOUND:${operation.id}`)
            if (batch.operationId !== operation.id) {
              throw new Error(`PROJECT_AGENT_TASK_BATCH_OPERATION_MISMATCH:${batch.operationId}:${operation.id}`)
            }
            if (!toolCallId) throw new Error(`PROJECT_AGENT_OPERATION_BATCH_TOOL_CALL_REQUIRED:${operation.id}`)
            const taskIds = Array.from(new Set(batch.taskIds.map((taskId) => taskId.trim()).filter(Boolean))).sort()
            if (taskIds.length === 0) throw new Error(`PROJECT_AGENT_TASK_BATCH_EMPTY:${operation.id}`)
            const operationBatch = params.operationBatch.claim(operation.id)
            const backgroundRunFence = params.operationBatch.readRunFence()
            const result = await bindProjectAgentOperationBatchWaitMemberInTransaction(transaction, {
              batch: operationBatch,
              backgroundRunFence,
              projectId: params.projectId,
              userId: params.userId,
              episodeId: params.context.episodeId ?? null,
              locale: params.context.locale ?? null,
              assistantId: 'workspace-command',
              operationId: operation.id,
              toolCallId,
              taskIds,
            })
            bound = true
            boundBatch = {
              toolCallId,
              operationId: operation.id,
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
      if (isSuspendingOperation(operation.agentFlow)) {
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
            operationId: operation.id,
            projectId: params.projectId,
            userId: params.userId,
            context: params.context,
            source: 'assistant-panel',
            writer: params.writer,
            input: normalizedInput,
            toolCallId,
            executionFence,
            taskBatchBinding,
            approvedInvocation: automaticApprovedInvocation,
            boundToolContractState: contract?.state,
          })
          reportExecutionSettled(execution.outcome)
          return execution.result
        } catch (error) {
          reportExecutionSettled({
            kind: 'failed',
            error: buildToolError({
              code: 'OPERATION_EXECUTION_FAILED',
              message: error instanceof Error ? error.message : String(error),
              operationId: operation.id,
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
              operationId: operation.id,
              targetKey: operationTargetKey,
              ...(toolCallId ? { toolCallId } : {}),
            },
          },
        ],
      }) : null
      if (startedActivity) writeActivityDataPart(params.writer, startedActivity)
      if (operation.intent === 'act') {
        writeOperationDataPart<ProjectAgentOperationStartPartData>(params.writer, 'data-agent-operation-start', {
          runId,
          operationId: operation.id,
          ...(toolCallId ? { toolCallId } : {}),
        })
      }
      try {
        const execution = await executeProjectAgentOperationFromTool({
          request: params.request,
          operationId: operation.id,
          projectId: params.projectId,
          userId: params.userId,
          context: params.context,
          source: 'assistant-panel',
          writer: params.writer,
          input: normalizedInput,
          toolCallId,
          activityId: operationActivityId,
          executionFence,
          taskBatchBinding,
          approvedInvocation: automaticApprovedInvocation,
          boundToolContractState: contract?.state,
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
            operationId: operation.id,
          }),
        })
        throw error
      }
    },
  })
  const gatewayNeedsApproval = gatewayTool.needsApproval as unknown as (
    runContext: RunContext<unknown>,
    input: unknown,
    toolCallId?: string,
  ) => Promise<boolean>
  const directTools = params.directOperations.map(({ operation, description }) => {
    const createGatewayInput = (input: unknown): {
      kind: 'static'
      operationId: string
      argumentsJson: string
    } => ({
      kind: 'static',
      operationId: operation.id,
      argumentsJson: JSON.stringify(input),
    })
    const markDirectInvocation = (toolCallId: string | null): string => {
      if (!toolCallId) throw new Error(`PROJECT_AGENT_TOOL_CALL_ID_MISSING:${operation.id}`)
      directOperationIdByToolCallId.set(toolCallId, operation.id)
      return toolCallId
    }
    return tool({
      name: operation.id,
      description,
      parameters: operation.toolInputSchema as never,
      strict: true,
      needsApproval: async (runContext, input, toolCallId) => {
        const identifiedToolCallId = markDirectInvocation(toolCallId?.trim() || null)
        try {
          return await gatewayNeedsApproval(
            runContext,
            createGatewayInput(input),
            identifiedToolCallId,
          )
        } finally {
          directOperationIdByToolCallId.delete(identifiedToolCallId)
        }
      },
      execute: async (input, runContext, details) => {
        if (!runContext) throw new Error('PROJECT_AGENT_DIRECT_TOOL_RUN_CONTEXT_REQUIRED')
        const toolCallId = markDirectInvocation(readToolCallId(details))
        try {
          return await gatewayTool.invoke(
            runContext,
            JSON.stringify(createGatewayInput(input)),
            details,
          )
        } finally {
          directOperationIdByToolCallId.delete(toolCallId)
        }
      },
    })
  })
  return [gatewayTool, ...directTools]
}
