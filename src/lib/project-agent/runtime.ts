import {
  createUIMessageStreamResponse,
  readUIMessageStream,
  safeValidateUIMessages,
  type UIMessage,
} from 'ai'
import {
  Agent,
  RunContext,
  RunState,
  run,
  type AgentInputItem,
  type FunctionToolResult,
  type RunToolApprovalItem,
  type Tool,
} from '@openai/agents'
import type { Prisma } from '@prisma/client'
import { aisdk } from '@openai/agents-extensions/ai-sdk'
import type { NextRequest } from 'next/server'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import type {
  ProjectAgentOperationOutcome,
  ProjectAgentOperationRegistry,
} from '@/lib/operations/types'
import { getRequestId } from '@/lib/api-errors'
import { createScopedLogger } from '@/lib/logging/core'
import type {
  AgentDebugPartData,
  AgentRuntimeContextPartData,
  ProjectAgentChoiceResolvedPartData,
  ProjectAgentContext,
  ProjectAgentInterruptionPartData,
  ProjectAgentInterruptionResolvedPartData,
  ProjectAgentRunPartData,
  ProjectAgentStopPartData,
} from './types'
import {
  localizeProjectAgentOperationTitle,
  localizeSelectableToolDescription,
} from './copy'
import { buildProjectAgentSystemPrompt } from './system-prompt'
import { normalizeProjectAgentLocale } from './locale'
import type { AssistantPermissionMode } from './permission-mode'
import { stableArgsHash } from './stable-args-hash'
import { compressMessages } from './message-compression'
import {
  resolveProjectAgentAssistantModelKey,
  resolveProjectAgentLanguageModel,
} from './model'
import { buildAiExecutionSessionId } from '@/lib/ai-exec/session'
import {
  prepareProjectAgentCollectingTaskWait,
  sealProjectAgentCollectingTaskWait,
  type ProjectAgentCollectingTaskWait,
  type ProjectAgentWaitFollowUp,
  type ProjectAgentWaitFollowUpMode,
} from './waits'
import {
  safelyReleaseProjectAgentRunLock,
  type ProjectAgentRunLock,
} from './run-lock'
import {
  isProjectAgentRunOwnershipLostError,
  startProjectAgentRunHeartbeat,
} from './run-heartbeat'
import type { EditFirstChoiceResult } from './edit-first-choice-result'
import { EDIT_FIRST_CHOICE_TOOL_IDS, type EditFirstChoiceType } from './edit-first-choice-tools'
import {
  type DeclinedProjectAgentInterruption,
  type ProjectAgentApprovalInterruptionRecord,
} from './interruptions'
import {
  type ProjectAgentContinuationTerminalOutcome,
  prepareProjectAgentApprovalExecutionHandoff,
  settleProjectAgentPreparedApprovalHandoff,
  settleProjectAgentPreparedChoiceHandoff,
  settleProjectAgentPreparedTaskHandoff,
  type ProjectAgentChoiceHandoffReceipt,
} from './execution-handoff'
import {
  settleProjectAgentRunFailureWithMessage,
  settleProjectAgentRunWithMessage,
  type ProjectAgentRunRecord,
  type ProjectAgentRunStatus,
} from './runs'
import { createProjectAgentRunFence } from './run-fence'
import type { ProjectAgentOperationExecutionFence } from './operation-execution-fence'
import {
  isSameProjectAgentSuspensionReceipt,
  type ProjectAgentSuspensionReceipt,
} from './suspension'
import { appendProjectAgentEvents } from './event'
import {
  isProjectAgentOperationAlwaysEnabled,
  isProjectAgentOperationEnabled,
  resolveProjectAgentToolset,
} from './toolset'
import { resolveProjectAgentTaskFollowUpTurnPolicy } from './task-follow-up-turn-policy'
import {
  resolveEditFirstWorkflowChoice,
  resolveEditFirstWorkflowView,
} from '@/lib/project-workflow/edit-first'
import type { EditFirstWorkflowView } from '@/lib/project-workflow/edit-first-view'
import { createProjectAgentOperationTool } from './agents-tool-adapter'
import {
  PROJECT_AGENT_MAX_TURNS,
  createProjectAgentStopController,
} from './stop-conditions'
import {
  createDataChunk,
  createProjectAgentUiMessageStream,
  type ProjectAgentUiChunk,
} from './agents-ui-stream'
import {
  appendProjectAssistantTextAttachmentsToUserText,
  readProjectAssistantTextAttachmentsFromMessage,
} from './text-attachments'
import { appendProjectAssistantThreadMessages } from './persistence'
import { resolveProjectPhase, type ProjectPhaseSnapshot } from './project-phase'
import {
  mergeOperationPlanViewsForApproval,
  type OperationPlanView,
} from '@/lib/operations/planning'
import { issueApprovalGrantGroup } from '@/lib/operations/planned-operation-invocation'
import {
  createProjectAgentApprovalPreflightStore,
  type ProjectAgentApprovalPreflightStore,
} from './approval-preflight'
import {
  createProjectAgentExecutionSegment,
  projectAgentExecutionStartedIdempotencyKey,
} from './execution-segment'

type UnknownObject = { [key: string]: unknown }

interface ProjectAgentAgentsRunContext {
  requestId: string
  projectId: string
  userId: string
  locale: string
}

function readProjectAgentRunOwnershipLoss(signal: AbortSignal): Error | null {
  const reason = signal.reason
  return isProjectAgentRunOwnershipLostError(reason) ? reason : null
}

function resolveProjectAgentRunFailureTerminal(params: {
  ownershipLoss: Error | null
  stopReason: string
  errorCode: string
  errorMessage: string
}): {
  status: 'failed' | 'cancelled'
  stopReason: string
  errorCode?: string
  errorMessage?: string
} {
  if (params.ownershipLoss) {
    return {
      status: 'cancelled',
      stopReason: 'run_lock_lost',
    }
  }
  return {
    status: 'failed',
    stopReason: params.stopReason,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
  }
}

/**
 * Control resolved by the route from the structured request body + database.
 * Choice controls carry the submitted user decision plus the identity of an
 * atomic confirmation Operation already committed by the Choice transaction,
 * when applicable. The model chooses only the subsequent tool from the
 * refreshed workflow availability.
 */
export type ProjectAgentResolvedControl =
  | {
    kind: 'user_turn'
    declinedInterruptions: DeclinedProjectAgentInterruption[]
  }
  | {
    kind: 'approval'
    interruption: ProjectAgentApprovalInterruptionRecord
    approved: boolean
    reason: string | null
  }
  | {
    kind: 'choice'
    interruptionId: string
    choiceType: EditFirstChoiceType
    toolCallId: string | null
    cardId: string | null
    appliedOperationId: string | null
    choiceResult: EditFirstChoiceResult
  }
  | {
    kind: 'task_follow_up'
    followUp: ProjectAgentWaitFollowUp
  }

export interface ProjectAgentTaskFollowUpSettlement {
  outcome: ProjectAgentContinuationTerminalOutcome
  message: UIMessage
}

function isRecord(value: unknown): value is UnknownObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const projectAgentLogger = createScopedLogger({
  module: 'project-agent.runtime',
})

function normalizeProjectAgentContext(raw: unknown): ProjectAgentContext {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const record = raw as UnknownObject
  const locale = typeof record.locale === 'string' ? record.locale.trim() : ''
  const episodeId = typeof record.episodeId === 'string' ? record.episodeId.trim() : ''
  const selectedScopeRef = typeof record.selectedScopeRef === 'string' ? record.selectedScopeRef.trim() : ''
  const selectedAssetId = typeof record.selectedAssetId === 'string' ? record.selectedAssetId.trim() : ''
  return {
    ...(locale ? { locale } : {}),
    ...(episodeId ? { episodeId } : {}),
    ...(selectedScopeRef ? { selectedScopeRef } : {}),
    ...(selectedAssetId ? { selectedAssetId } : {}),
  }
}

function estimateContextTokens(value: unknown): number | null {
  try {
    return Math.ceil(JSON.stringify(value).length / 4)
  } catch {
    return null
  }
}

function readTextFromParts(parts: readonly unknown[]): string {
  return parts.flatMap((part) => {
    if (!isRecord(part)) return []
    if (part.type !== 'text') return []
    const text = part.text
    return typeof text === 'string' && text.trim() ? [text] : []
  }).join('\n')
}

function toAgentInputItems(messages: UIMessage[], locale: ReturnType<typeof normalizeProjectAgentLocale>): AgentInputItem[] {
  const items: AgentInputItem[] = []
  for (const message of messages) {
    const text = readTextFromParts(message.parts)
    if (message.role === 'user') {
      const attachments = readProjectAssistantTextAttachmentsFromMessage(message)
      const content = appendProjectAssistantTextAttachmentsToUserText({
        locale,
        userText: text,
        attachments,
      })
      if (!content.trim()) continue
      items.push({
        role: 'user',
        content,
      } satisfies AgentInputItem)
      continue
    }
    if (!text.trim()) continue
    if (message.role === 'assistant') {
      items.push({
        role: 'assistant',
        status: 'completed',
        content: [{
          type: 'output_text',
          text,
        }],
      } satisfies AgentInputItem)
    }
  }
  return items
}

function createAgentRunStatusChunk(params: {
  runId: string
  requestId: string
  status: ProjectAgentRunPartData['status']
  controlKind: ProjectAgentRunPartData['controlKind']
  stopReason?: string | null
}): ProjectAgentUiChunk {
  return createDataChunk('data-agent-run', {
    runId: params.runId,
    requestId: params.requestId,
    status: params.status,
    controlKind: params.controlKind,
    stopReason: params.stopReason ?? null,
  } satisfies ProjectAgentRunPartData)
}

function createPersistedAssistantMessageId(params: {
  runId: string
  controlKind: ProjectAgentRunRecord['controlKind']
  requestId: string
}): string {
  return `workspace-assistant-run:${params.controlKind}:${params.runId}:${params.requestId}`
}

function createChunkReplayStream(chunks: readonly ProjectAgentUiChunk[]): ReadableStream<ProjectAgentUiChunk> {
  return new ReadableStream<ProjectAgentUiChunk>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }
      controller.close()
    },
  })
}

function buildAssistantMessageFromDataChunks(params: {
  messageId: string
  chunks: readonly ProjectAgentUiChunk[]
}): UIMessage | null {
  const parts = params.chunks.flatMap((chunk) => {
    const record = chunk as { type?: unknown; data?: unknown }
    if (typeof record.type !== 'string' || !record.type.startsWith('data-')) return []
    return [{
      type: record.type,
      data: record.data,
    } as UIMessage['parts'][number]]
  })
  if (parts.length === 0) return null
  return {
    id: params.messageId,
    role: 'assistant',
    parts,
  }
}

async function buildAssistantMessageFromChunks(params: {
  messageId: string
  chunks: readonly ProjectAgentUiChunk[]
}): Promise<UIMessage> {
  let latestMessage: UIMessage | null = null
  for await (const message of readUIMessageStream({
    stream: createChunkReplayStream(params.chunks),
    terminateOnError: true,
    message: {
      id: params.messageId,
      role: 'assistant',
      parts: [],
    },
  })) {
    latestMessage = message
  }
  if (!latestMessage || latestMessage.parts.length === 0) {
    const dataMessage = buildAssistantMessageFromDataChunks(params)
    if (dataMessage) return dataMessage
    throw new Error('PROJECT_AGENT_ASSISTANT_MESSAGE_EMPTY')
  }
  return latestMessage
}

/**
 * Projects a control fact into the model input. Control decisions live in
 * interruption rows, never in message history — so when a pending approval is
 * declined out-of-band (the user replied instead of answering the card), the
 * fresh run must be told explicitly. This mirrors what state.reject() does for
 * the card-deny path; without it the model would re-attempt the operation it
 * just announced.
 */
function buildDeclinedApprovalsInputItem(
  declined: DeclinedProjectAgentInterruption[],
): AgentInputItem | null {
  const declinedApprovals = declined.filter((item) => item.type === 'approval')
  if (declinedApprovals.length === 0) return null
  const lines = [
    '[approval_declined]',
    ...declinedApprovals.map((item) => `operation=${item.operationId}`),
    'The user did not approve the pending operation approval(s) above and sent a new message instead. Treat the approval(s) as rejected: do not re-run or re-request these operations unless the user explicitly asks. Respond to the user message that follows.',
  ]
  return {
    role: 'user',
    content: lines.join('\n'),
  } satisfies AgentInputItem
}

/**
 * The declined-approval note must be read before the user's new message, so it
 * is inserted right before the trailing user item.
 */
function withDeclinedApprovalsNote(
  items: AgentInputItem[],
  note: AgentInputItem | null,
): AgentInputItem[] {
  if (!note) return items
  const lastItem = items[items.length - 1]
  const isTrailingUserItem = !!lastItem && 'role' in lastItem && lastItem.role === 'user'
  if (!isTrailingUserItem) return [...items, note]
  return [...items.slice(0, items.length - 1), note, lastItem]
}

export function buildTaskFollowUpInputItem(
  followUp: ProjectAgentWaitFollowUp,
): AgentInputItem {
  const lines = [
    '[task_update]',
    `operation=${followUp.operationId}`,
    `status=${followUp.terminalStatus}`,
    `total=${String(followUp.total)} succeeded=${String(followUp.successCount)} failed=${String(followUp.failedCount)}`,
    ...(followUp.failedTaskIds.length > 0 ? [`failedTaskIds=${followUp.failedTaskIds.join(',')}`] : []),
    ...(followUp.failedTasks.length > 0 ? [`failedTasks=${JSON.stringify(followUp.failedTasks)}`] : []),
  ]
  return {
    role: 'user',
    content: lines.join('\n'),
  } satisfies AgentInputItem
}

function formatRuntimeStateValue(value: string | null | undefined): string {
  const normalized = value?.trim().replace(/\s+/g, ' ') ?? ''
  return normalized || 'none'
}

function formatRuntimeStateList(values: readonly string[]): string {
  return values.length > 0 ? values.map(formatRuntimeStateValue).join(',') : 'none'
}

function buildProjectStateVersion(params: {
  phase: ProjectPhaseSnapshot
  enabledOperationIds: readonly string[]
}): string {
  const workflow = params.phase.editFirstWorkflow
  return [
    params.phase.phase,
    workflow.step,
    workflow.status.kind,
    workflow.operationPolicy.recommendedAction?.operationId ?? 'none',
    workflow.operationPolicy.group?.id ?? 'none',
    params.phase.planning.editBibleStatus ?? 'none',
    String(params.phase.planning.chapterCount),
    String(params.phase.progress.plannedVideoSegmentCount),
    String(params.phase.progress.completedVideoSegmentCount),
    params.enabledOperationIds.join('|') || 'none',
  ].map(formatRuntimeStateValue).join(':')
}

function buildProjectStateInputItem(params: {
  projectId: string
  episodeId: string | null
  phase: ProjectPhaseSnapshot
  enabledOperationIds: readonly string[]
}): AgentInputItem {
  const workflow = params.phase.editFirstWorkflow
  const operationGroup = workflow.operationPolicy.group
  const lines = [
    '[project_state_snapshot]',
    `version=${buildProjectStateVersion({
      phase: params.phase,
      enabledOperationIds: params.enabledOperationIds,
    })}`,
    `projectId=${formatRuntimeStateValue(params.projectId)}`,
    `episodeId=${formatRuntimeStateValue(params.episodeId)}`,
    `phase=${formatRuntimeStateValue(params.phase.phase)}`,
    `workflowAvailable=${String(workflow.status.kind !== 'inactive')}`,
    `workflowStep=${formatRuntimeStateValue(workflow.step)}`,
    `workflowStatus=${workflow.status.kind}`,
    `workflowStatusReason=${formatRuntimeStateValue(workflow.status.reason)}`,
    `workflowRecommendedOperation=${formatRuntimeStateValue(workflow.operationPolicy.recommendedAction?.operationId)}`,
    `workflowOperationGroup=${formatRuntimeStateValue(operationGroup?.id)}`,
    `workflowOperationGroupIds=${formatRuntimeStateList(operationGroup?.operationIds ?? [])}`,
    `workflowApprovalOperationIds=${formatRuntimeStateList(operationGroup?.approvalOperationIds ?? [])}`,
    `allowedOperationIds=${formatRuntimeStateList(workflow.operationPolicy.allowedOperationIds)}`,
    `enabledOperationIds=${formatRuntimeStateList(params.enabledOperationIds)}`,
    `planning.editBibleStatus=${formatRuntimeStateValue(params.phase.planning.editBibleStatus)}`,
    `planning.chapterCount=${String(params.phase.planning.chapterCount)}`,
    `progress.plannedVideoSegmentCount=${String(params.phase.progress.plannedVideoSegmentCount)}`,
    `progress.completedVideoSegmentCount=${String(params.phase.progress.completedVideoSegmentCount)}`,
    '[/project_state_snapshot]',
  ]
  return {
    role: 'system',
    content: lines.join('\n'),
  } as AgentInputItem
}

function createDebugTextChunks(text: string): ProjectAgentUiChunk[] {
  return [
    { type: 'start' },
    { type: 'start-step' },
    { type: 'text-start', id: 'agent-debug' },
    { type: 'text-delta', id: 'agent-debug', delta: text },
    { type: 'text-end', id: 'agent-debug' },
    { type: 'finish-step' },
  ].map((chunk) => chunk as unknown as ProjectAgentUiChunk)
}

function collectFunctionToolOutputs(
  toolResults: FunctionToolResult[],
  outcomesByToolCall: Map<string, ProjectAgentOperationOutcome>,
): Array<{ toolName: string; outcome: ProjectAgentOperationOutcome }> {
  return toolResults.flatMap((result) => {
    if (result.type !== 'function_output') return []
    const toolCallId = readApprovalString(result.runItem.rawItem, 'callId')
      ?? readApprovalString(result.runItem.rawItem, 'id')
    if (!toolCallId) {
      throw new Error(`PROJECT_AGENT_TOOL_OUTCOME_CALL_ID_MISSING:${result.tool.name}`)
    }
    const outcome = outcomesByToolCall.get(toolCallId)
    if (!outcome) {
      throw new Error(`PROJECT_AGENT_TOOL_OUTCOME_MISSING:${result.tool.name}:${toolCallId}`)
    }
    outcomesByToolCall.delete(toolCallId)
    return [{
      toolName: result.tool.name,
      outcome,
    }]
  })
}

function readApprovalString(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null
  const raw = value[key]
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

function readApprovalId(item: RunToolApprovalItem): string {
  return readApprovalString(item.rawItem, 'id')
    ?? readApprovalString(item.rawItem, 'callId')
    ?? `${item.name ?? 'tool'}:${crypto.randomUUID()}`
}

function readApprovalToolCallId(item: RunToolApprovalItem): string | null {
  return readApprovalString(item.rawItem, 'callId') ?? readApprovalString(item.rawItem, 'id')
}

function readApprovalInput(item: RunToolApprovalItem): unknown {
  const rawItem: Record<string, unknown> = isRecord(item.rawItem) ? item.rawItem : {}
  const candidates = [
    rawItem.arguments,
    rawItem.args,
    rawItem.input,
  ]
  for (const candidate of candidates) {
    if (isRecord(candidate)) return candidate
    if (typeof candidate === 'string' && candidate.trim()) {
      const parsed: unknown = JSON.parse(candidate)
      if (isRecord(parsed)) return parsed
    }
  }
  return null
}

interface PersistedApprovalGroupItem {
  readonly approvalId: string
  readonly operationId: string
  readonly toolCallId: string | null
  readonly operationPlan: OperationPlanView | null
}

function readPersistedApprovalOperationPlan(
  value: unknown,
  operationId: string,
): OperationPlanView | null {
  if (value === null || value === undefined) return null
  if (
    !isRecord(value)
    || value.kind !== 'task_submission'
    || value.operationId !== operationId
    || typeof value.planSnapshotId !== 'string'
    || !value.planSnapshotId.trim()
    || typeof value.taskCount !== 'number'
    || !isRecord(value.quote)
    || !Array.isArray(value.tasks)
  ) {
    throw new Error(`PROJECT_AGENT_APPROVAL_MEMBER_PLAN_INVALID:${operationId}`)
  }
  return value as unknown as OperationPlanView
}

function readApprovalGroupItems(value: unknown): readonly PersistedApprovalGroupItem[] {
  if (!isRecord(value) || !Array.isArray(value.approvalItems)) return []
  const items = value.approvalItems.map((item) => {
    if (!isRecord(item)) throw new Error('PROJECT_AGENT_APPROVAL_MEMBER_INVALID')
    const approvalId = typeof item.approvalId === 'string' ? item.approvalId.trim() : ''
    const operationId = typeof item.operationId === 'string' ? item.operationId.trim() : ''
    const toolCallId = typeof item.toolCallId === 'string' ? item.toolCallId.trim() || null : null
    if (!approvalId || !operationId) throw new Error('PROJECT_AGENT_APPROVAL_MEMBER_IDENTITY_INVALID')
    return {
      approvalId,
      operationId,
      toolCallId,
      operationPlan: readPersistedApprovalOperationPlan(item.operationPlan, operationId),
    }
  })
  if (new Set(items.map((item) => item.operationId)).size !== items.length) {
    throw new Error('PROJECT_AGENT_APPROVAL_MEMBER_OPERATION_DUPLICATE')
  }
  return items
}

async function buildApprovalOperationPlanView(params: {
  item: RunToolApprovalItem
  operation: ProjectAgentOperationRegistry[string] | undefined
  toolCallId: string | null
  approvalPreflightStore: ProjectAgentApprovalPreflightStore
}): Promise<OperationPlanView | null> {
  if (!params.operation?.plan) return null
  const rawInput = readApprovalInput(params.item)
  const operationPlan = params.approvalPreflightStore.getPlanned({
    operationId: params.operation.id,
    toolCallId: params.toolCallId,
    input: rawInput,
  })
  if (!operationPlan) {
    throw new Error(`PROJECT_AGENT_APPROVAL_PREFLIGHT_PLAN_MISSING:${params.operation.id}`)
  }
  return operationPlan
}

function matchesApprovalItem(item: RunToolApprovalItem, approvalId: string): boolean {
  return readApprovalString(item.rawItem, 'id') === approvalId
    || readApprovalString(item.rawItem, 'callId') === approvalId
}

function findApprovalItem(
  state: RunState<ProjectAgentAgentsRunContext, Agent<ProjectAgentAgentsRunContext>>,
  approvalId: string,
): RunToolApprovalItem {
  const approvalItem = state.getInterruptions().find((item) => matchesApprovalItem(item, approvalId))
  if (!approvalItem) {
    throw new Error(`PROJECT_AGENT_APPROVAL_ITEM_NOT_FOUND approvalId=${approvalId}`)
  }
  return approvalItem
}

function resolveWaitFollowUpModeForOperations(
  registry: ProjectAgentOperationRegistry,
  operationIds: string[],
): ProjectAgentWaitFollowUpMode {
  if (operationIds.length === 0) return 'resume_agent'
  const allComplete = operationIds.every((operationId) => (
    registry[operationId]?.agentFlow?.onTaskComplete === 'complete'
  ))
  if (allComplete) return 'complete'
  return 'resume_agent'
}

async function createProjectAgentWaitBindings(params: {
  stopPart: ProjectAgentStopPartData | null
  registry: ProjectAgentOperationRegistry
  transactionallyBoundTaskBatches: ReadonlyMap<string, readonly string[]>
  committedSuspensions: ReadonlyMap<string, ProjectAgentSuspensionReceipt>
  collectingTaskWait?: ProjectAgentCollectingTaskWait | null
  runFence: ReturnType<typeof createProjectAgentRunFence>
  executionSegmentId: string
  projectId: string
  userId: string
  episodeId: string | null
  locale: string
}): Promise<ProjectAgentWaitFollowUpMode | null> {
  if (!params.stopPart || params.stopPart.reason !== 'awaiting_external_task' || params.stopPart.taskIds.length === 0) {
    return null
  }
  if (params.collectingTaskWait) {
    const expectedOperationIds = [...params.collectingTaskWait.operationIds].sort()
    const actualOperationIds = params.stopPart.taskWaits.map((wait) => wait.operationId).sort()
    if (JSON.stringify(actualOperationIds) !== JSON.stringify(expectedOperationIds)) {
      throw new Error(`PROJECT_AGENT_WAIT_GROUP_MEMBER_MISMATCH:${expectedOperationIds.join(',')}:${actualOperationIds.join(',')}`)
    }
    const taskIds = Array.from(new Set(params.stopPart.taskWaits.flatMap((wait) => wait.taskIds))).sort()
    for (const taskWait of params.stopPart.taskWaits) {
      const boundTaskIds = params.transactionallyBoundTaskBatches.get(taskWait.operationId)
      const suspension = params.committedSuspensions.get(taskWait.operationId)
      if (!boundTaskIds || !suspension || suspension.kind !== 'task') {
        throw new Error(`PROJECT_AGENT_WAIT_GROUP_MEMBER_NOT_BOUND:${taskWait.operationId}`)
      }
      if (suspension.waitId !== params.collectingTaskWait.waitId) {
        throw new Error(`PROJECT_AGENT_WAIT_GROUP_IDENTITY_MISMATCH:${taskWait.operationId}`)
      }
    }
    const sealed = await sealProjectAgentCollectingTaskWait({
      runFence: params.runFence,
      runId: params.runFence.runId,
      executionSegmentId: params.executionSegmentId,
      projectId: params.projectId,
      userId: params.userId,
      episodeId: params.episodeId,
      locale: params.locale,
      assistantId: 'workspace-command',
      operationId: params.collectingTaskWait.operationId,
      taskIds,
      followUpMode: params.collectingTaskWait.followUpMode,
      group: params.collectingTaskWait,
    })
    params.committedSuspensions.forEach((suspension) => {
      if (suspension.kind !== 'task') return
      if (suspension.waitId !== sealed.waitId) {
        throw new Error(`PROJECT_AGENT_WAIT_GROUP_SEALED_RECEIPT_MISMATCH:${suspension.operationId}`)
      }
    })
    return sealed.followUpMode
  }
  if (params.stopPart.taskWaits.length !== 1) {
    throw new Error(`PROJECT_AGENT_WAIT_GROUP_REQUIRED:${params.stopPart.operationIds.join(',')}`)
  }
  const taskWait = params.stopPart.taskWaits[0]
  if (!taskWait) throw new Error('PROJECT_AGENT_TASK_WAIT_DESCRIPTOR_MISSING')
  const followUpMode = resolveWaitFollowUpModeForOperations(params.registry, [taskWait.operationId])
  const boundTaskIds = params.transactionallyBoundTaskBatches.get(taskWait.operationId)
  if (!boundTaskIds) throw new Error(`PROJECT_AGENT_TASK_BATCH_WAIT_NOT_BOUND:${taskWait.operationId}`)
  const expected = Array.from(new Set(taskWait.taskIds)).sort()
  const actual = Array.from(new Set(boundTaskIds)).sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`PROJECT_AGENT_TASK_BATCH_WAIT_IDENTITY_MISMATCH:${taskWait.operationId}`)
  }
  const suspension = params.committedSuspensions.get(taskWait.operationId)
  if (!suspension || suspension.kind !== 'task') {
    throw new Error(`PROJECT_AGENT_TASK_SUSPENSION_RECEIPT_MISSING:${taskWait.operationId}`)
  }
  const suspendedTaskIds = Array.from(new Set(suspension.taskIds)).sort()
  if (
    suspension.operationId !== taskWait.operationId
    || JSON.stringify(suspendedTaskIds) !== JSON.stringify(expected)
    || suspension.followUpMode !== followUpMode
  ) {
    throw new Error(`PROJECT_AGENT_TASK_SUSPENSION_RECEIPT_MISMATCH:${taskWait.operationId}`)
  }
  return suspension.followUpMode
}

function requireProjectAgentChoiceSuspensionReceipt(params: {
  stopPart: ProjectAgentStopPartData | null
  preparedChoiceHandoffs: ReadonlyMap<string, ProjectAgentChoiceHandoffReceipt>
}): ProjectAgentChoiceHandoffReceipt | null {
  if (!params.stopPart || params.stopPart.reason !== 'awaiting_user_confirmation') return null
  if (params.stopPart.operationIds.length !== 1) {
    throw new Error(`PROJECT_AGENT_MULTIPLE_CHOICE_SUSPENSIONS_UNSUPPORTED:${params.stopPart.operationIds.join(',')}`)
  }
  const operationId = params.stopPart.operationIds[0]
  if (!operationId) throw new Error('PROJECT_AGENT_CHOICE_SUSPENSION_OPERATION_MISSING')
  const handoff = params.preparedChoiceHandoffs.get(operationId)
  if (!handoff || handoff.kind !== 'choice' || handoff.operationId !== operationId) {
    throw new Error(`PROJECT_AGENT_CHOICE_HANDOFF_MISSING:${operationId}`)
  }
  return handoff
}

interface ProjectAgentLiveWorkflowState {
  get(): Promise<EditFirstWorkflowView>
  invalidate(): void
}

/**
 * Live view of the edit-first workflow state for one run. Tool isEnabled
 * predicates read it before every model turn; every operation execution
 * invalidates it, so a step advanced by a completed operation is visible to
 * the very next turn's tool surface. Lookups are deduplicated; refresh
 * failures must fail the run because stale workflow state would expose the
 * wrong tool surface.
 */
function createProjectAgentLiveWorkflowState(params: {
  requestId: string
  projectId: string
  userId: string
  episodeId: string | null
  initial: EditFirstWorkflowView
}): ProjectAgentLiveWorkflowState {
  let current = params.initial
  let stale = false
  let pending: Promise<EditFirstWorkflowView> | null = null
  return {
    async get() {
      if (!stale) return current
      pending ??= resolveEditFirstWorkflowView({
        projectId: params.projectId,
        userId: params.userId,
        episodeId: params.episodeId,
      })
        .then((workflow) => {
          current = workflow
          stale = false
          return workflow
        })
        .finally(() => {
          pending = null
        })
      return pending
    },
    invalidate() {
      stale = true
    },
  }
}

function buildRunContext(params: {
  requestId: string
  projectId: string
  userId: string
  locale: string
}): RunContext<ProjectAgentAgentsRunContext> {
  return new RunContext<ProjectAgentAgentsRunContext>({
    requestId: params.requestId,
    projectId: params.projectId,
    userId: params.userId,
    locale: params.locale,
  })
}

export async function createProjectAgentChatResponse(input: {
  request: NextRequest
  userId: string
  projectId: string
  context: unknown
  messages: unknown
  assistantPermissionMode: AssistantPermissionMode
  run: ProjectAgentRunRecord
  control: ProjectAgentResolvedControl
  runLock?: ProjectAgentRunLock | null
  ownershipSignal?: AbortSignal | null
  continuationClaim?: ProjectAgentOperationExecutionFence['continuationClaim']
  settleTaskFollowUp?: (outcome: ProjectAgentTaskFollowUpSettlement) => Promise<void>
  confirmTaskFollowUpSettlement?: () => Promise<void>
  onTaskFollowUpSettlementFailure?: (error: unknown) => void
}): Promise<Response> {
  const stableRequestId = getRequestId(input.request) ?? crypto.randomUUID()
  const runFence = createProjectAgentRunFence(input.run)
  const validation = await safeValidateUIMessages({ messages: input.messages })
  if (!validation.success) {
    throw new Error('PROJECT_AGENT_INVALID_MESSAGES')
  }
  const normalizedMessages = validation.data
  if (normalizedMessages.length === 0) {
    throw new Error('PROJECT_AGENT_EMPTY_MESSAGES')
  }

  const assistantModelKey = await resolveProjectAgentAssistantModelKey(input.userId)

  const control = input.control
  const executionSegment = control.kind === 'user_turn'
    ? createProjectAgentExecutionSegment({ kind: 'user_turn', runId: input.run.id })
    : control.kind === 'approval'
      ? createProjectAgentExecutionSegment({
          kind: 'approval_response',
          interruptionId: control.interruption.id,
        })
      : control.kind === 'choice'
        ? createProjectAgentExecutionSegment({
            kind: 'choice_response',
            interruptionId: control.interruptionId,
          })
        : createProjectAgentExecutionSegment({
            kind: 'task_follow_up',
            commandId: control.followUp.commandId,
          })
  const executionControlKind = executionSegment.controlKind
  const contextBase = normalizeProjectAgentContext(input.context)
  const locale = normalizeProjectAgentLocale(contextBase.locale)
  const persistedApprovalItems = control.kind === 'approval'
    ? readApprovalGroupItems(control.interruption.payload)
    : []
  const issuedApprovalGrants = control.kind === 'approval' && control.approved
    ? await issueApprovalGrantGroup({
        userId: input.userId,
        requests: persistedApprovalItems.flatMap((item) => item.operationPlan?.planSnapshotId
          ? [{
              planSnapshotId: item.operationPlan.planSnapshotId,
              requestId: `assistant-approval:${control.interruption.id}`,
            }]
          : []),
      })
    : []
  const approvedInvocationByOperationId = Object.fromEntries(issuedApprovalGrants.map((grant) => [
    grant.operationId,
    {
      approvalGrantId: grant.approvalGrantId,
      requestId: grant.requestId,
    },
  ]))
  const context: ProjectAgentContext = {
    ...contextBase,
    locale,
    runId: input.run.id,
    runFence,
    executionSegmentId: executionSegment.id,
    choiceDecision: control.kind === 'choice' ? control.choiceResult.decision : null,
    ...(issuedApprovalGrants.length > 0
      ? {
          approvedInvocationByOperationId,
        }
      : {}),
  }
  const resolvedPhase = await resolveProjectPhase({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: context.episodeId || null,
  })
  const phase = control.kind === 'choice' && !control.appliedOperationId
    ? {
        ...resolvedPhase,
        editFirstWorkflow: resolveEditFirstWorkflowChoice(
          resolvedPhase.editFirstWorkflow,
          control.choiceResult.choiceDecision,
        ),
      }
    : resolvedPhase
  const openRouterSessionId = buildAiExecutionSessionId({
    kind: 'project-agent',
    userId: input.userId,
    projectId: input.projectId,
    episodeId: context.episodeId || null,
    assistantId: 'workspace-command',
    modelKey: assistantModelKey,
  })
  const resolved = await resolveProjectAgentLanguageModel({
    userId: input.userId,
    assistantModelKey,
    openRouterSessionId,
  })
  let runLockReleased = false
  const releaseRunLockOnce = async () => {
    if (!input.runLock || runLockReleased) return
    runLockReleased = true
    await safelyReleaseProjectAgentRunLock(input.runLock)
  }
  let heartbeatStopped = false
  let taskFollowUpSettlementFailureReported = false
  const reportTaskFollowUpSettlementFailure = (error: unknown): void => {
    if (taskFollowUpSettlementFailureReported) return
    taskFollowUpSettlementFailureReported = true
    input.onTaskFollowUpSettlementFailure?.(error)
  }
  const runAbortController = new AbortController()
  const abortFromOwnershipSignal = (): void => {
    if (!runAbortController.signal.aborted) {
      runAbortController.abort(input.ownershipSignal?.reason)
    }
  }
  if (input.ownershipSignal?.aborted) {
    abortFromOwnershipSignal()
  } else {
    input.ownershipSignal?.addEventListener('abort', abortFromOwnershipSignal, { once: true })
  }
  const detachOwnershipSignal = (): void => {
    input.ownershipSignal?.removeEventListener('abort', abortFromOwnershipSignal)
  }
  let heartbeatController: ReturnType<typeof startProjectAgentRunHeartbeat> | null = null
  const stopHeartbeatOnce = async () => {
    if (!heartbeatController || heartbeatStopped) return
    heartbeatStopped = true
    await heartbeatController.stop()
  }
  const requestId = stableRequestId

  try {
    heartbeatController = startProjectAgentRunHeartbeat({
      runId: input.run.id,
      runLock: input.runLock,
      onOwnershipLost: (error) => {
        if (!runAbortController.signal.aborted) runAbortController.abort(error)
      },
    })
    if (control.kind === 'user_turn') {
      await appendProjectAgentEvents({
        scope: {
          projectId: input.projectId,
          userId: input.userId,
          episodeId: context.episodeId || null,
          assistantId: 'workspace-command',
        },
        events: [{
          runFence,
          idempotencyKey: projectAgentExecutionStartedIdempotencyKey(executionSegment.id),
          event: {
            kind: 'run.execution_started',
            runId: input.run.id,
            executionSegmentId: executionSegment.id,
            controlKind: executionControlKind,
          },
        }],
      })
    }
    const runtimeMessages = control.kind === 'approval'
      ? normalizedMessages
      : await compressMessages({
          messages: normalizedMessages,
          locale,
          model: resolved.languageModel,
          signal: runAbortController.signal,
        })

  const agentDebug = new URL(input.request.url).searchParams.get('agentDebug') === '1'
  const operations = createProjectAgentOperationRegistry()
  const approvalInterruption = control.kind === 'approval' ? control.interruption : null
  const workflowOperationGroup = phase.editFirstWorkflow.operationPolicy.group
  const workflowGroupOperationIds = workflowOperationGroup?.operationIds ?? []
  const workflowApprovalOperationIds = workflowOperationGroup?.approvalOperationIds ?? []
  const approvalGroupOperationIds = approvalInterruption
    ? persistedApprovalItems.map((item) => item.operationId).sort()
    : workflowApprovalOperationIds.length > 0
      ? workflowGroupOperationIds
      : []
  const collectingOperationIds = control.kind === 'approval'
    ? control.approved ? approvalGroupOperationIds : []
    : workflowApprovalOperationIds.length === 0 ? workflowGroupOperationIds : []
  const collectingTaskWait = collectingOperationIds.length > 1
    ? await prepareProjectAgentCollectingTaskWait({
        runFence,
        runId: input.run.id,
        executionSegmentId: executionSegment.id,
        projectId: input.projectId,
        userId: input.userId,
        episodeId: context.episodeId ?? null,
        locale,
        assistantId: 'workspace-command',
        operationId: collectingOperationIds[0] ?? 'operation_group',
        operationIds: collectingOperationIds,
        taskIds: [],
        followUpMode: resolveWaitFollowUpModeForOperations(operations, [...collectingOperationIds]),
      })
    : null
  const liveWorkflow = createProjectAgentLiveWorkflowState({
    requestId,
    projectId: input.projectId,
    userId: input.userId,
    episodeId: context.episodeId || null,
    initial: phase.editFirstWorkflow,
  })
  const approvalPreflightStore = createProjectAgentApprovalPreflightStore()
  const taskFollowUpTurnPolicy = control.kind === 'task_follow_up'
    ? resolveProjectAgentTaskFollowUpTurnPolicy(control.followUp.terminalStatus)
    : null
  const toolset = resolveProjectAgentToolset({
    registry: operations,
    context,
    resumeOperationId: approvalInterruption?.operationId ?? null,
    disabledOperationIds: control.kind === 'choice' ? [EDIT_FIRST_CHOICE_TOOL_IDS[control.choiceType]] : [],
  })
  const operationIds = toolset.operationIds
  const initialEnabledOperationIds = operationIds.filter((operationId) => {
    const operation = operations[operationId]
    if (!operation) return false
    return (taskFollowUpTurnPolicy?.allowOperationIntent(operation.intent) ?? true)
      && isProjectAgentOperationEnabled({
        toolset,
        workflow: phase.editFirstWorkflow,
        operationId,
      })
  })
  const initialChoiceContinuationOperationId = control.kind === 'choice'
    ? phase.editFirstWorkflow.operationPolicy.recommendedAction?.operationId ?? null
    : null
  if (
    initialChoiceContinuationOperationId
    && !initialEnabledOperationIds.includes(initialChoiceContinuationOperationId)
  ) {
    throw new Error(`PROJECT_AGENT_CHOICE_CONTINUATION_NOT_ENABLED:${initialChoiceContinuationOperationId}`)
  }
  const selectedTools = operationIds.map((operationId) => {
    const operation = operations[operationId]
    if (!operation) {
      throw new Error(`PROJECT_AGENT_OPERATION_NOT_FOUND operationId=${operationId}`)
    }
    return {
      operation,
      description: localizeSelectableToolDescription(operationId, operation.summary, locale),
    }
  })
  const toolDescriptions = new Map(selectedTools.map((item) => [item.operation.id, item.description]))
  const projectStateInputItem = buildProjectStateInputItem({
    projectId: input.projectId,
    episodeId: context.episodeId || null,
    phase,
    enabledOperationIds: initialEnabledOperationIds,
  })

  const agentInput: AgentInputItem[] = control.kind === 'approval'
    ? []
    : [
        ...(control.kind === 'user_turn'
          ? withDeclinedApprovalsNote(
              toAgentInputItems(runtimeMessages, locale),
              buildDeclinedApprovalsInputItem(control.declinedInterruptions),
            )
          : toAgentInputItems(runtimeMessages, locale)),
        ...(control.kind === 'choice' ? control.choiceResult.inputItems : []),
        ...(control.kind === 'task_follow_up' ? [buildTaskFollowUpInputItem(control.followUp)] : []),
        projectStateInputItem,
      ]

  const initialChunks: ProjectAgentUiChunk[] = [
    createAgentRunStatusChunk({
      runId: input.run.id,
      requestId,
      status: 'running',
      controlKind: executionControlKind,
      stopReason: null,
    }),
    createDataChunk('data-agent-runtime-context', {
      runtime: 'openai-agents-sdk',
      requestId,
      modelKey: assistantModelKey,
      locale,
      assistantPermissionMode: input.assistantPermissionMode,
      projectId: input.projectId,
      episodeId: context.episodeId || null,
      messageCounts: {
        normalized: normalizedMessages.length,
        runtime: runtimeMessages.length,
        model: agentInput.length,
      },
      contextTokenEstimate: estimateContextTokens(agentInput),
      toolset: {
        source: toolset.source,
        coreOperationIds: toolset.coreOperationIds,
        workflowOperationIds: toolset.workflowOperationIds,
        initialEnabledOperationIds,
        resumeOperationId: toolset.resumeOperationId,
        includeChoiceOperation: toolset.includeChoiceOperation,
      },
      editFirstWorkflow: phase.editFirstWorkflow,
      selectedTools: selectedTools.map((item) => ({
        operationId: item.operation.id,
        description: item.description,
      })),
    } satisfies AgentRuntimeContextPartData),
  ]

  if (control.kind === 'approval') {
    initialChunks.push(createDataChunk('data-agent-interruption-resolved', {
      runId: input.run.id,
      interruptionId: control.interruption.id,
      approvalId: control.interruption.approvalId,
      outcome: control.approved ? 'approved' : 'rejected',
    } satisfies ProjectAgentInterruptionResolvedPartData))
  }
  if (control.kind === 'user_turn') {
    for (const declined of control.declinedInterruptions) {
      initialChunks.push(createDataChunk('data-agent-interruption-resolved', {
        runId: declined.runId,
        interruptionId: declined.id,
        approvalId: declined.approvalId,
        outcome: declined.type === 'approval' ? 'rejected' : 'superseded',
      } satisfies ProjectAgentInterruptionResolvedPartData))
    }
  }
  if (control.kind === 'choice') {
    initialChunks.push(createDataChunk('data-assistant-choice-resolved', {
      runId: input.run.id,
      interruptionId: control.interruptionId,
      choiceType: control.choiceType,
      toolCallId: control.toolCallId,
      cardId: control.cardId,
    } satisfies ProjectAgentChoiceResolvedPartData))
  }

  if (agentDebug) {
    initialChunks.push(...createDebugTextChunks([
      '[agentDebug]',
      `requestId=${requestId}`,
      'runtime=openai-agents-sdk',
      `control=${control.kind}`,
      `toolsetSource=${toolset.source}`,
      `coreTools=${String(toolset.coreOperationIds.length)}`,
      `workflowTools=${String(toolset.workflowOperationIds.length)}`,
      `tools=${String(operationIds.length)}`,
      `enabledTools=${String(initialEnabledOperationIds.length)}`,
      `editFirstStep=${phase.editFirstWorkflow.step}`,
      `editFirstStatus=${phase.editFirstWorkflow.status.kind}`,
    ].join('\n')))
    initialChunks.push(createDataChunk('data-agent-debug', {
      requestId,
      toolsetSource: toolset.source,
      coreOperationIds: toolset.coreOperationIds,
      workflowOperationIds: toolset.workflowOperationIds,
      operationIds,
    } satisfies AgentDebugPartData))
  }

  projectAgentLogger.info({
    action: 'assistant.toolset.resolved',
    message: 'Project agent deterministic toolset resolved',
    requestId,
    projectId: input.projectId,
    userId: input.userId,
    details: {
      runtime: 'openai-agents-sdk',
      control: control.kind,
      editFirstWorkflow: phase.editFirstWorkflow,
      toolset,
    },
  })

  let latestStopPart: ProjectAgentStopPartData | null = null
  const transactionallyBoundTaskBatches = new Map<string, readonly string[]>()
  const committedSuspensions = new Map<string, ProjectAgentSuspensionReceipt>()
  const preparedChoiceHandoffs = new Map<string, ProjectAgentChoiceHandoffReceipt>()
  const outcomesByToolCall = new Map<string, ProjectAgentOperationOutcome>()
  const stopController = createProjectAgentStopController()
  const sideChannelChunks: ProjectAgentUiChunk[] = []
  const drainSideChannelChunks = () => sideChannelChunks.splice(0, sideChannelChunks.length)
  const tools: Tool<ProjectAgentAgentsRunContext>[] = selectedTools.map((item) => (
    createProjectAgentOperationTool({
      request: input.request,
      operation: item.operation,
      description: item.description,
      projectId: input.projectId,
      userId: input.userId,
      context,
      runFence,
      operationSignal: runAbortController.signal,
      continuationClaim: input.continuationClaim ?? null,
      assistantPermissionMode: input.assistantPermissionMode,
      writer: {
        write: (chunk) => {
          sideChannelChunks.push(chunk as unknown as ProjectAgentUiChunk)
        },
        merge: () => {
          throw new Error('PROJECT_AGENT_TOOL_WRITER_MERGE_UNSUPPORTED')
        },
        onError: (error) => (error instanceof Error ? error.message : String(error)),
      },
      ...(isProjectAgentOperationAlwaysEnabled(toolset, item.operation.id) ? {} : {
        isEnabled: async () => (
          (taskFollowUpTurnPolicy?.allowOperationIntent(item.operation.intent) ?? true)
          && isProjectAgentOperationEnabled({
            toolset,
            workflow: await liveWorkflow.get(),
            operationId: item.operation.id,
          })
        ),
      }),
      onExecutionSettled: ({ toolCallId, outcome }) => {
        if (!toolCallId) {
          throw new Error(`PROJECT_AGENT_TOOL_OUTCOME_CALL_ID_MISSING:${item.operation.id}`)
        }
        if (outcomesByToolCall.has(toolCallId)) {
          throw new Error(`PROJECT_AGENT_TOOL_OUTCOME_DUPLICATE:${item.operation.id}:${toolCallId}`)
        }
        outcomesByToolCall.set(toolCallId, outcome)
        if (outcome.kind === 'wait_choice') {
          const choiceHandoff = outcome.choiceHandoff
          const existing = preparedChoiceHandoffs.get(choiceHandoff.operationId)
          if (
            existing
            && (
              existing.handoffId !== choiceHandoff.handoffId
              || existing.executionSegmentId !== choiceHandoff.executionSegmentId
            )
          ) {
            throw new Error(`PROJECT_AGENT_CHOICE_HANDOFF_DUPLICATE:${choiceHandoff.operationId}`)
          }
          preparedChoiceHandoffs.set(choiceHandoff.operationId, choiceHandoff)
        }
        liveWorkflow.invalidate()
      },
      onTaskBatchBound: (batch) => {
        if (transactionallyBoundTaskBatches.has(batch.operationId)) {
          throw new Error(`PROJECT_AGENT_TASK_BATCH_DUPLICATE_BINDING:${batch.operationId}`)
        }
        transactionallyBoundTaskBatches.set(batch.operationId, [...batch.taskIds])
        const existing = committedSuspensions.get(batch.operationId)
        if (existing && !isSameProjectAgentSuspensionReceipt(existing, batch.suspension)) {
          throw new Error(`PROJECT_AGENT_SUSPENSION_RECEIPT_DUPLICATE:${batch.operationId}`)
        }
        committedSuspensions.set(batch.operationId, batch.suspension)
      },
      approvalPreflightStore,
      approvalBarrierOperationIds: approvalGroupOperationIds,
      collectingTaskWait,
    }) as Tool<ProjectAgentAgentsRunContext>
  ))

  const systemPrompt = buildProjectAgentSystemPrompt({
    locale,
    projectId: input.projectId,
    episodeId: context.episodeId || 'unknown',
    assistantPermissionMode: input.assistantPermissionMode,
  })
  const agent = new Agent<ProjectAgentAgentsRunContext>({
    name: 'Project Workspace Agent',
    instructions: systemPrompt,
    model: aisdk(resolved.languageModel as unknown as Parameters<typeof aisdk>[0]),
    modelSettings: {
      temperature: 0.2,
    },
    tools,
    toolUseBehavior: (_runContext, toolResults) => {
      const outcomes = collectFunctionToolOutputs(toolResults, outcomesByToolCall)
      const stopPart = stopController.evaluateStep(outcomes)
      if (!stopPart) {
        return {
          isFinalOutput: false,
          isInterrupted: undefined,
        }
      }
      latestStopPart = stopPart
      return {
        isFinalOutput: true,
        finalOutput: '',
      }
    },
  })
  const runContext = buildRunContext({
    requestId,
    projectId: input.projectId,
    userId: input.userId,
    locale,
  })

  const runInput = approvalInterruption
    ? await (async () => {
        const state = await RunState.fromStringWithContext<ProjectAgentAgentsRunContext, Agent<ProjectAgentAgentsRunContext>>(
          agent,
          approvalInterruption.runState,
          runContext,
          { contextStrategy: 'replace' },
        )
        const storedApprovalItems = readApprovalGroupItems(approvalInterruption.payload)
        const approvals = storedApprovalItems.length > 0
          ? storedApprovalItems.map((item) => findApprovalItem(state, item.approvalId))
          : [findApprovalItem(state, approvalInterruption.approvalId)]
        for (const approvalItem of approvals) {
          if (control.kind === 'approval' && control.approved) {
            state.approve(approvalItem)
          } else {
            state.reject(approvalItem, {
              message: (control.kind === 'approval' ? control.reason : null) || 'PROJECT_AGENT_TOOL_APPROVAL_REJECTED',
            })
          }
        }
        // The serialized SDK state is the immutable continuation of the exact
        // tool call the model requested. Rewriting its original input here can
        // turn an approval resume into a fresh model turn and strand the
        // already-approved invocation. Tools read current durable workflow
        // state through their execution context, so the frozen model turn must
        // remain byte-for-byte intact until its approved call has settled.
        return state
      })()
    : agentInput

    const result = await run(agent, runInput, {
      stream: true,
      maxTurns: PROJECT_AGENT_MAX_TURNS,
      context: runContext,
      toolNotFoundBehavior: 'raise_error',
      signal: runAbortController.signal,
    })
    let runStatusFinalized = false
    let taskFollowUpSettlement: ProjectAgentContinuationTerminalOutcome | null = null
    let taskFollowUpSettlementCommittedInline = false
    let pendingRunSettlement: {
      status: ProjectAgentRunStatus
      stopReason: string
      errorCode?: string
      errorMessage?: string
    } | null = null
    let assistantMessagePersisted = false
    let preparedAssistantMessage: UIMessage | null = null
    let latestRunStatusForPersistence: Pick<ProjectAgentRunPartData, 'status' | 'stopReason'> | null = null
    const persistedAssistantChunks: ProjectAgentUiChunk[] = []
    const recordAssistantChunk = (chunk: ProjectAgentUiChunk): void => {
      if ((chunk as { type?: unknown }).type === 'finish') return
      persistedAssistantChunks.push(chunk)
    }
    const createRuntimeStatusChunk = (
      status: ProjectAgentRunPartData['status'],
      stopReason?: string | null,
    ): ProjectAgentUiChunk => {
      latestRunStatusForPersistence = {
        status,
        stopReason: stopReason ?? null,
      }
      return createAgentRunStatusChunk({
        runId: input.run.id,
        requestId,
        status,
        controlKind: executionControlKind,
        stopReason,
      })
    }
    const buildAssistantMessageOnce = async (): Promise<UIMessage> => {
      if (preparedAssistantMessage) return preparedAssistantMessage
      recordLatestRunStatusForPersistence()
      preparedAssistantMessage = await buildAssistantMessageFromChunks({
        messageId: createPersistedAssistantMessageId({
          runId: input.run.id,
          controlKind: executionControlKind,
          requestId,
        }),
        chunks: persistedAssistantChunks,
      })
      return preparedAssistantMessage
    }
    const persistAssistantMessageOnce = async (): Promise<void> => {
      if (assistantMessagePersisted) return
      const message = await buildAssistantMessageOnce()
      await appendProjectAssistantThreadMessages({
        projectId: input.projectId,
        userId: input.userId,
        episodeId: context.episodeId || null,
        assistantId: 'workspace-command',
        messages: [message],
      })
      assistantMessagePersisted = true
    }
    const persistAssistantMessageOrSettleRun = async (): Promise<void> => {
      if (!pendingRunSettlement) {
        await persistAssistantMessageOnce()
        return
      }
      if (assistantMessagePersisted) {
        throw new Error(`PROJECT_AGENT_RUN_MESSAGE_SETTLEMENT_ORDER_INVALID:${input.run.id}`)
      }
      const message = await buildAssistantMessageOnce()
      await settleProjectAgentRunWithMessage({
        runFence,
        expectedStatuses: ['running'],
        ...pendingRunSettlement,
        message,
      })
      assistantMessagePersisted = true
      pendingRunSettlement = null
    }
    const recordLatestRunStatusForPersistence = (): void => {
      if (!latestRunStatusForPersistence) return
      const lastChunk = persistedAssistantChunks[persistedAssistantChunks.length - 1] as {
        type?: unknown
        data?: unknown
      } | undefined
      if (
        lastChunk?.type === 'data-agent-run'
        && lastChunk.data
        && typeof lastChunk.data === 'object'
        && !Array.isArray(lastChunk.data)
      ) {
        const data = lastChunk.data as Record<string, unknown>
        if (
          data.status === latestRunStatusForPersistence.status
          && data.stopReason === latestRunStatusForPersistence.stopReason
        ) return
      }
      recordAssistantChunk(createAgentRunStatusChunk({
        runId: input.run.id,
        requestId,
        status: latestRunStatusForPersistence.status,
        controlKind: executionControlKind,
        stopReason: latestRunStatusForPersistence.stopReason,
      }))
    }
    const stream = createProjectAgentUiMessageStream({
      source: result,
      initialChunks,
      drainChunks: drainSideChannelChunks,
      onChunk: recordAssistantChunk,
      beforeFinish: async () => {
        const chunks: ProjectAgentUiChunk[] = []
        let completionError: unknown = null
        try {
          await result.completed
        } catch (error) {
          completionError = error
        }

        const approvalItems = result.interruptions.length > 0
          ? result.interruptions
          : result.state.getInterruptions()
        const shouldPersistApprovalInterruption = approvalItems.length > 0 && latestStopPart?.reason !== 'awaiting_external_task'
        const pendingApprovalHandoff = shouldPersistApprovalInterruption
          ? await (async () => {
            const members = await Promise.all(approvalItems.map(async (approvalItem) => {
              const approvalId = readApprovalId(approvalItem)
              const operationId = approvalItem.name ?? 'unknown_operation'
              const toolCallId = readApprovalToolCallId(approvalItem)
              const operationPlan = await buildApprovalOperationPlanView({
                item: approvalItem,
                operation: operations[operationId],
                toolCallId,
                approvalPreflightStore,
              })
              return {
                approvalId,
                operationId,
                toolCallId,
                inputHash: operationPlan?.inputHash ?? stableArgsHash(readApprovalInput(approvalItem)),
                operationPlan,
              }
            }))
            const expectedGroupIds = phase.editFirstWorkflow.operationPolicy.group?.operationIds ?? []
            if (expectedGroupIds.length > 0) {
              const expected = Array.from(new Set(expectedGroupIds)).sort()
              const actual = Array.from(new Set(members.map((member) => member.operationId))).sort()
              if (JSON.stringify(actual) !== JSON.stringify(expected)) {
                throw new Error(`PROJECT_AGENT_OPERATION_GROUP_INCOMPLETE:${expected.join(',')}:${actual.join(',')}`)
              }
            }
            const primary = members.find((member) => member.operationPlan) ?? members[0]
            if (!primary) throw new Error('PROJECT_AGENT_APPROVAL_GROUP_EMPTY')
            return {
              approvalId: primary.approvalId,
              operationId: primary.operationId,
              toolCallId: primary.toolCallId,
              inputHash: primary.inputHash,
              operationPlan: mergeOperationPlanViewsForApproval(
                primary.operationId,
                members.flatMap((member) => member.operationPlan ? [member.operationPlan] : []),
              ),
              members,
              runState: result.state.toString(),
            }
          })()
          : null

        try {
          await createProjectAgentWaitBindings({
            stopPart: latestStopPart,
            registry: operations,
            transactionallyBoundTaskBatches,
            committedSuspensions,
            collectingTaskWait,
            runFence,
            executionSegmentId: executionSegment.id,
            projectId: input.projectId,
            userId: input.userId,
            episodeId: context.episodeId ?? null,
            locale,
          })
        } catch (error) {
          if (input.settleTaskFollowUp) throw error
          const errorMessage = error instanceof Error ? error.message : String(error)
          pendingRunSettlement = {
            status: 'failed',
            stopReason: 'wait_binding_failed',
            errorCode: 'PROJECT_AGENT_WAIT_BINDING_FAILED',
            errorMessage,
          }
          chunks.push(createRuntimeStatusChunk('failed', 'wait_binding_failed'))
          runStatusFinalized = true
          return chunks
        }
        const preparedChoiceHandoff = requireProjectAgentChoiceSuspensionReceipt({
          stopPart: latestStopPart,
          preparedChoiceHandoffs,
        })
        if (latestStopPart) {
          chunks.push(createDataChunk('data-agent-stop', latestStopPart))
        }

        if (completionError && !shouldPersistApprovalInterruption) {
          if (input.settleTaskFollowUp) throw completionError
          pendingRunSettlement = {
            status: 'failed',
            stopReason: 'completion_error',
            errorCode: 'PROJECT_AGENT_RUN_COMPLETION_FAILED',
            errorMessage: completionError instanceof Error ? completionError.message : String(completionError),
          }
          chunks.push(createRuntimeStatusChunk('failed', 'completion_error'))
          runStatusFinalized = true
          throw completionError
        }
        if (pendingApprovalHandoff) {
          chunks.push(createRuntimeStatusChunk('awaiting_approval', 'awaiting_approval'))
          const preparedApprovalHandoff = await prepareProjectAgentApprovalExecutionHandoff({
            executionFence: {
              runFence,
              signal: runAbortController.signal,
              continuationClaim: input.continuationClaim ?? null,
            },
            executionSegmentId: executionSegment.id,
            projectId: input.projectId,
            userId: input.userId,
            episodeId: context.episodeId || null,
            locale,
            assistantId: 'workspace-command',
            operationId: pendingApprovalHandoff.operationId,
            approvalId: pendingApprovalHandoff.approvalId,
            toolCallId: pendingApprovalHandoff.toolCallId,
            runState: pendingApprovalHandoff.runState,
            payload: {
              operationId: pendingApprovalHandoff.operationId,
              toolCallId: pendingApprovalHandoff.toolCallId,
              inputHash: pendingApprovalHandoff.inputHash,
              approvalItems: pendingApprovalHandoff.members.map((member) => ({
                approvalId: member.approvalId,
                operationId: member.operationId,
                toolCallId: member.toolCallId,
                inputHash: member.inputHash,
                operationPlan: member.operationPlan,
              })),
              ...(pendingApprovalHandoff.operationPlan
                ? { operationPlan: pendingApprovalHandoff.operationPlan }
                : {}),
            } as unknown as Prisma.InputJsonValue,
          })
          const approvalSuspension = await settleProjectAgentPreparedApprovalHandoff({
            executionFence: {
              runFence,
              signal: runAbortController.signal,
              continuationClaim: input.continuationClaim ?? null,
            },
            handoff: preparedApprovalHandoff,
            projectId: input.projectId,
            userId: input.userId,
            episodeId: context.episodeId || null,
            assistantId: 'workspace-command',
            message: await buildAssistantMessageOnce(),
            continuation: control.kind === 'task_follow_up'
              ? (() => {
                  const claimOwner = input.continuationClaim?.claimOwner
                  const waitActivityId = control.followUp.activityId
                  if (!claimOwner || !waitActivityId) {
                    throw new Error('PROJECT_AGENT_CONTINUATION_SETTLEMENT_IDENTITY_MISSING')
                  }
                  return {
                    waitId: control.followUp.waitId,
                    commandId: control.followUp.commandId,
                    claimOwner,
                    waitActivityId,
                  }
                })()
              : null,
          })
          assistantMessagePersisted = true
          chunks.push(createDataChunk('data-agent-interruption', {
            runId: input.run.id,
            requestId,
            interruptionId: approvalSuspension.interruptionId,
            approvalId: pendingApprovalHandoff.approvalId,
            operationId: pendingApprovalHandoff.operationId,
            toolCallId: pendingApprovalHandoff.toolCallId,
            inputHash: pendingApprovalHandoff.inputHash,
            display: {
              title: localizeProjectAgentOperationTitle(
                pendingApprovalHandoff.operationId,
                normalizeProjectAgentLocale(locale),
              ),
              description: toolDescriptions.get(pendingApprovalHandoff.operationId)
                ?? pendingApprovalHandoff.operationId,
            },
            operationPlan: pendingApprovalHandoff.operationPlan,
          } satisfies ProjectAgentInterruptionPartData))
          if (control.kind === 'task_follow_up') taskFollowUpSettlementCommittedInline = true
          runStatusFinalized = true
        } else if (!shouldPersistApprovalInterruption) {
          if (latestStopPart?.reason === 'awaiting_external_task') {
            chunks.push(createRuntimeStatusChunk('awaiting_task', 'awaiting_task'))
            const taskWait = collectingTaskWait
              ? {
                  operationId: collectingTaskWait.operationId,
                  taskIds: Array.from(new Set(latestStopPart.taskWaits.flatMap((wait) => wait.taskIds))).sort(),
                }
              : latestStopPart.taskWaits.length === 1 && latestStopPart.taskWaits[0]
                ? latestStopPart.taskWaits[0]
                : null
            if (!taskWait) throw new Error('PROJECT_AGENT_TASK_HANDOFF_WAIT_DESCRIPTOR_MISSING')
            await settleProjectAgentPreparedTaskHandoff({
              executionFence: {
                runFence,
                signal: runAbortController.signal,
                continuationClaim: input.continuationClaim ?? null,
              },
              executionSegmentId: executionSegment.id,
              projectId: input.projectId,
              userId: input.userId,
              episodeId: context.episodeId || null,
              assistantId: 'workspace-command',
              operationId: taskWait.operationId,
              taskIds: taskWait.taskIds,
              message: await buildAssistantMessageOnce(),
              continuation: control.kind === 'task_follow_up'
                ? (() => {
                    const claimOwner = input.continuationClaim?.claimOwner
                    const waitActivityId = control.followUp.activityId
                    if (!claimOwner || !waitActivityId) {
                      throw new Error('PROJECT_AGENT_CONTINUATION_SETTLEMENT_IDENTITY_MISSING')
                    }
                    return {
                      waitId: control.followUp.waitId,
                      commandId: control.followUp.commandId,
                      claimOwner,
                      waitActivityId,
                    }
                  })()
                : null,
            })
            if (control.kind === 'task_follow_up') taskFollowUpSettlementCommittedInline = true
            assistantMessagePersisted = true
            runStatusFinalized = true
          } else if (latestStopPart?.reason === 'awaiting_user_confirmation') {
            chunks.push(createRuntimeStatusChunk('awaiting_choice', 'awaiting_user_choice'))
            if (!preparedChoiceHandoff) {
              throw new Error('PROJECT_AGENT_CHOICE_HANDOFF_REQUIRED_FOR_CHOICE_STOP')
            }
            const choiceSuspension = await settleProjectAgentPreparedChoiceHandoff({
              executionFence: {
                runFence,
                signal: runAbortController.signal,
                continuationClaim: input.continuationClaim ?? null,
              },
              handoff: preparedChoiceHandoff,
              projectId: input.projectId,
              userId: input.userId,
              episodeId: context.episodeId || null,
              assistantId: 'workspace-command',
              message: await buildAssistantMessageOnce(),
              continuation: control.kind === 'task_follow_up'
                ? (() => {
                    const claimOwner = input.continuationClaim?.claimOwner
                    const waitActivityId = control.followUp.activityId
                    if (!claimOwner || !waitActivityId) {
                      throw new Error('PROJECT_AGENT_CONTINUATION_SETTLEMENT_IDENTITY_MISSING')
                    }
                    return {
                      waitId: control.followUp.waitId,
                      commandId: control.followUp.commandId,
                      claimOwner,
                      waitActivityId,
                    }
                  })()
                : null,
            })
            if (control.kind === 'task_follow_up') {
              taskFollowUpSettlementCommittedInline = true
            }
            assistantMessagePersisted = true
            chunks.push(createDataChunk('data-assistant-choice-card', choiceSuspension.card))
            runStatusFinalized = true
          } else if (latestStopPart?.reason === 'tool_error') {
            if (input.settleTaskFollowUp) taskFollowUpSettlement = 'failed'
            else pendingRunSettlement = {
                status: 'failed',
                stopReason: 'tool_error',
                errorCode: latestStopPart.codes[0] ?? 'PROJECT_AGENT_TOOL_ERROR',
                errorMessage: latestStopPart.operationIds.join(','),
              }
            chunks.push(createRuntimeStatusChunk('failed', 'tool_error'))
            runStatusFinalized = true
          } else {
            if (input.settleTaskFollowUp) {
              taskFollowUpSettlement = 'completed'
            }
            else pendingRunSettlement = {
                status: 'completed',
                stopReason: 'completed',
              }
            chunks.push(createRuntimeStatusChunk('completed', 'completed'))
            runStatusFinalized = true
          }
        }
        return chunks
      },
      onError: async (error) => {
        const ownershipLoss = readProjectAgentRunOwnershipLoss(runAbortController.signal)
        const effectiveError = ownershipLoss ?? error
        const errorMessage = effectiveError instanceof Error ? effectiveError.message : String(effectiveError)
        projectAgentLogger.error({
          action: 'assistant.agents.stream.failed',
          message: 'Project agent UI message stream failed',
          requestId,
          projectId: input.projectId,
          userId: input.userId,
          details: {
            runId: input.run.id,
            episodeId: context.episodeId || null,
            error: errorMessage,
            workflowStep: phase.editFirstWorkflow.step,
            workflowStatus: phase.editFirstWorkflow.status.kind,
            stopReason: latestStopPart?.reason ?? null,
            runStatusFinalized,
          },
        })
        if (runStatusFinalized) {
          recordLatestRunStatusForPersistence()
          await persistAssistantMessageOrSettleRun()
          return
        }
        if (input.settleTaskFollowUp) {
          reportTaskFollowUpSettlementFailure(effectiveError)
          return
        }
        const failureTerminal = resolveProjectAgentRunFailureTerminal({
          ownershipLoss,
          stopReason: 'stream_error',
          errorCode: 'PROJECT_AGENT_STREAM_FAILED',
          errorMessage,
        })
        pendingRunSettlement = failureTerminal
        recordAssistantChunk(createRuntimeStatusChunk(
          failureTerminal.status,
          failureTerminal.stopReason,
        ))
        await persistAssistantMessageOrSettleRun()
        runStatusFinalized = true
      },
      onCancel: async () => {
        if (input.settleTaskFollowUp) {
          throw new Error('PROJECT_AGENT_CONTINUATION_STREAM_CANCELLED')
        }
        pendingRunSettlement = {
          status: 'cancelled',
          stopReason: 'stream_cancelled',
        }
        recordAssistantChunk(createRuntimeStatusChunk('cancelled', 'stream_cancelled'))
        await persistAssistantMessageOrSettleRun()
        runStatusFinalized = true
      },
      onSettled: async () => {
        try {
          if (input.settleTaskFollowUp) {
            if (taskFollowUpSettlementCommittedInline) {
              if (!input.confirmTaskFollowUpSettlement) {
                throw new Error('PROJECT_AGENT_TASK_FOLLOW_UP_INLINE_CONFIRMATION_MISSING')
              }
              await input.confirmTaskFollowUpSettlement()
            } else {
              if (!taskFollowUpSettlement) throw new Error('PROJECT_AGENT_TASK_FOLLOW_UP_SETTLEMENT_MISSING')
              await input.settleTaskFollowUp({
                outcome: taskFollowUpSettlement,
                message: await buildAssistantMessageOnce(),
              })
            }
          } else {
            await persistAssistantMessageOrSettleRun()
          }
        } catch (error) {
          if (input.settleTaskFollowUp) reportTaskFollowUpSettlementFailure(error)
          projectAgentLogger.error({
            action: 'assistant.agents.settlement.failed',
            message: 'Project agent message and run settlement failed',
            requestId,
            projectId: input.projectId,
            userId: input.userId,
            details: {
              runId: input.run.id,
              episodeId: context.episodeId || null,
              error: error instanceof Error ? error.message : String(error),
            },
          })
          throw error
        } finally {
          detachOwnershipSignal()
          await stopHeartbeatOnce()
          await releaseRunLockOnce()
        }
      },
    })
    const response = createUIMessageStreamResponse({ stream })
    response.headers.set('x-request-id', stableRequestId)
    return response
  } catch (error) {
    detachOwnershipSignal()
    await stopHeartbeatOnce()
    try {
      if (!input.settleTaskFollowUp) {
        const ownershipLoss = readProjectAgentRunOwnershipLoss(runAbortController.signal)
        const terminal = resolveProjectAgentRunFailureTerminal({
          ownershipLoss,
          stopReason: 'run_failed',
          errorCode: 'PROJECT_AGENT_RUN_FAILED',
          errorMessage: error instanceof Error ? error.message : String(error),
        })
        await settleProjectAgentRunFailureWithMessage({
          runFence,
          controlKind: executionControlKind,
          requestId,
          ...terminal,
        })
      }
    } finally {
      await releaseRunLockOnce()
    }
    const message = error instanceof Error ? error.message : String(error)
    projectAgentLogger.error({
      action: 'assistant.agents.run.failed',
      message: 'Project agent Agents SDK run failed',
      requestId,
      projectId: input.projectId,
      userId: input.userId,
      details: {
        error: message,
      },
    })
    throw new Error(`PROJECT_AGENT_RUN_FAILED requestId=${requestId}: ${message}`)
  }
}
