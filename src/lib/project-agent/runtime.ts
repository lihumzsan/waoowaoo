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
import { prisma } from '@/lib/prisma'
import {
  readProjectCreativeResourceWorkingSet,
  type CreativeResourceWorkingSetView,
} from '@/lib/creative-resource'
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
import { readAssistantBillingConfirmationRequired } from './billing-confirmation'
import { stableArgsHash } from './stable-args-hash'
import { compressMessages } from './message-compression'
import {
  resolveProjectAgentAssistantModelKey,
  resolveProjectAgentLanguageModel,
} from './model'
import { buildAiExecutionSessionId } from '@/lib/ai-exec/session'
import { readProjectAgentPlan, type ProjectAgentPlanSnapshot } from './plan'
import {
  type ProjectAgentWaitFollowUp,
  sealProjectAgentOperationBatchWait,
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
import { appendProjectAgentEvents } from './event'
import {
  resolveProjectAgentToolset,
} from './toolset'
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
import {
  createProjectAgentOperationBatchCoordinator,
  type ProjectAgentOperationBatchCoordinator,
} from './operation-batch'

type UnknownObject = { [key: string]: unknown }

interface ProjectAgentAgentsRunContext {
  requestId: string
  projectId: string
  userId: string
  locale: string
}

class ProjectAgentClientDisconnectedError extends Error {
  constructor() {
    super('PROJECT_AGENT_CLIENT_DISCONNECTED')
    this.name = 'ProjectAgentClientDisconnectedError'
  }
}

function readProjectAgentRunOwnershipLoss(signal: AbortSignal): Error | null {
  const reason = signal.reason
  return isProjectAgentRunOwnershipLostError(reason) ? reason : null
}

function readProjectAgentClientDisconnect(signal: AbortSignal): ProjectAgentClientDisconnectedError | null {
  return signal.reason instanceof ProjectAgentClientDisconnectedError ? signal.reason : null
}

function resolveProjectAgentRunFailureTerminal(params: {
  ownershipLoss: Error | null
  clientDisconnect: ProjectAgentClientDisconnectedError | null
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
  if (params.clientDisconnect) {
    return {
      status: 'cancelled',
      stopReason: 'stream_cancelled',
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
    ...(followUp.completedTasks.length > 0 ? [`completedTasks=${JSON.stringify(followUp.completedTasks)}`] : []),
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

function buildProjectStateVersion(params: {
  videoRatio: string | null
  videoRatioConfirmationVersion: number
  phase: ProjectPhaseSnapshot
  creativeWorkingSet: CreativeResourceWorkingSetView
}): string {
  const workflow = params.phase.editFirstWorkflow
  return [
    params.videoRatio ?? 'none',
    String(params.videoRatioConfirmationVersion),
    params.phase.phase,
    workflow.step,
    workflow.status.kind,
    workflow.recommendation.recommendedAction?.operationId ?? 'none',
    params.phase.planning.editBibleStatus ?? 'none',
    String(params.phase.planning.chapterCount),
    String(params.phase.progress.plannedVideoSegmentCount),
    String(params.phase.progress.completedVideoSegmentCount),
    params.creativeWorkingSet.confirmedScreenplay?.fingerprint ?? 'none',
    params.creativeWorkingSet.adoptedStyleBible?.fingerprint ?? 'none',
    ...params.creativeWorkingSet.bindings.map((binding) => `${binding.bindingId}:${String(binding.version)}`),
  ].map(formatRuntimeStateValue).join(':')
}

function buildProjectStateInputItem(params: {
  projectId: string
  episodeId: string | null
  videoRatio: string | null
  videoRatioConfirmedAt: Date | null
  videoRatioConfirmationVersion: number
  phase: ProjectPhaseSnapshot
  creativeWorkingSet: CreativeResourceWorkingSetView
}): AgentInputItem {
  const workflow = params.phase.editFirstWorkflow
  const lines = [
    '[project_state_snapshot]',
    `version=${buildProjectStateVersion({
      videoRatio: params.videoRatio,
      videoRatioConfirmationVersion: params.videoRatioConfirmationVersion,
      phase: params.phase,
      creativeWorkingSet: params.creativeWorkingSet,
    })}`,
    `projectId=${formatRuntimeStateValue(params.projectId)}`,
    `episodeId=${formatRuntimeStateValue(params.episodeId)}`,
    `config.videoRatio=${formatRuntimeStateValue(params.videoRatio)}`,
    `config.videoRatioConfirmed=${String(Boolean(params.videoRatio && params.videoRatioConfirmedAt && params.videoRatioConfirmationVersion > 0))}`,
    `config.videoRatioConfirmationVersion=${String(params.videoRatioConfirmationVersion)}`,
    `phase=${formatRuntimeStateValue(params.phase.phase)}`,
    `mainlineStep=${formatRuntimeStateValue(workflow.step)}`,
    `mainlineStatus=${workflow.status.kind}`,
    `mainlineStatusReason=${formatRuntimeStateValue(workflow.status.reason)}`,
    `mainlineRecommendedOperation=${formatRuntimeStateValue(workflow.recommendation.recommendedAction?.operationId)}`,
    `planning.editBibleStatus=${formatRuntimeStateValue(params.phase.planning.editBibleStatus)}`,
    `planning.chapterCount=${String(params.phase.planning.chapterCount)}`,
    `progress.plannedVideoSegmentCount=${String(params.phase.progress.plannedVideoSegmentCount)}`,
    `progress.completedVideoSegmentCount=${String(params.phase.progress.completedVideoSegmentCount)}`,
    `creativeWorkingSet.confirmedScreenplay=${JSON.stringify(params.creativeWorkingSet.confirmedScreenplay)}`,
    `creativeWorkingSet.adoptedStyleBible=${JSON.stringify(params.creativeWorkingSet.adoptedStyleBible)}`,
    `creativeWorkingSet.bindings=${JSON.stringify(params.creativeWorkingSet.bindings)}`,
    `creativeWorkingSet.availableResources=${JSON.stringify(params.creativeWorkingSet.availableResources)}`,
    '[/project_state_snapshot]',
  ]
  return {
    role: 'system',
    content: lines.join('\n'),
  } as AgentInputItem
}

function buildProjectAgentPlanInputItem(plan: ProjectAgentPlanSnapshot): AgentInputItem {
  return {
    role: 'system',
    content: [
      '[agent_plan]',
      JSON.stringify(plan),
      '[/agent_plan]',
    ].join('\n'),
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
): Array<{ toolCallId: string; toolName: string; outcome: ProjectAgentOperationOutcome }> {
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
      toolCallId,
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
  if (new Set(items.map((item) => item.approvalId)).size !== items.length) {
    throw new Error('PROJECT_AGENT_APPROVAL_MEMBER_APPROVAL_ID_DUPLICATE')
  }
  if (items.some((item) => !item.toolCallId) || new Set(items.map((item) => item.toolCallId)).size !== items.length) {
    throw new Error('PROJECT_AGENT_APPROVAL_MEMBER_TOOL_CALL_ID_INVALID')
  }
  const planSnapshotIds = items.flatMap((item) => item.operationPlan?.planSnapshotId
    ? [item.operationPlan.planSnapshotId]
    : [])
  if (new Set(planSnapshotIds).size !== planSnapshotIds.length) {
    throw new Error('PROJECT_AGENT_APPROVAL_MEMBER_PLAN_SNAPSHOT_DUPLICATE')
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
  const billingConfirmationRequired = await readAssistantBillingConfirmationRequired(input.userId)

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
  const issuedGrantByPlanSnapshotId = new Map(issuedApprovalGrants.map((grant) => [grant.planSnapshotId, grant]))
  const approvedInvocationByToolCallId = Object.fromEntries(persistedApprovalItems.flatMap((item) => {
    const planSnapshotId = item.operationPlan?.planSnapshotId ?? null
    if (!item.toolCallId || !planSnapshotId) return []
    const grant = issuedGrantByPlanSnapshotId.get(planSnapshotId)
    if (!grant || grant.operationId !== item.operationId) {
      throw new Error(`PROJECT_AGENT_APPROVAL_GRANT_MEMBER_MISMATCH:${item.toolCallId}`)
    }
    return [[item.toolCallId, {
      approvalGrantId: grant.approvalGrantId,
      requestId: grant.requestId,
    }] as const]
  }))
  const context: ProjectAgentContext = {
    ...contextBase,
    locale,
    runId: input.run.id,
    runFence,
    executionSegmentId: executionSegment.id,
    userTurnText: control.kind === 'user_turn'
      && normalizedMessages[normalizedMessages.length - 1]?.role === 'user'
      ? readTextFromParts(normalizedMessages[normalizedMessages.length - 1]?.parts ?? []) || null
      : null,
    choiceDecision: control.kind === 'choice' ? control.choiceResult.decision : null,
    ...(issuedApprovalGrants.length > 0
      ? {
          approvedInvocationByToolCallId,
        }
      : {}),
  }
  const [resolvedPhase, projectConfigSnapshot, creativeWorkingSet] = await Promise.all([
    resolveProjectPhase({
      projectId: input.projectId,
      userId: input.userId,
      episodeId: context.episodeId || null,
    }),
    prisma.project.findFirst({
      where: { id: input.projectId, userId: input.userId },
      select: {
        videoRatio: true,
        videoRatioConfirmedAt: true,
        videoRatioConfirmationVersion: true,
      },
    }),
    readProjectCreativeResourceWorkingSet({
      projectId: input.projectId,
      userId: input.userId,
      episodeId: context.episodeId || null,
    }),
  ])
  if (!projectConfigSnapshot) throw new Error(`PROJECT_AGENT_PROJECT_NOT_FOUND:${input.projectId}`)
  const phase = resolvedPhase
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
    modelKey: assistantModelKey,
    reasoningPurpose: 'assistant',
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
  const abortFromRequestSignal = (): void => {
    if (!runAbortController.signal.aborted) {
      runAbortController.abort(new ProjectAgentClientDisconnectedError())
    }
  }
  if (input.ownershipSignal?.aborted) {
    abortFromOwnershipSignal()
  } else {
    input.ownershipSignal?.addEventListener('abort', abortFromOwnershipSignal, { once: true })
  }
  if (input.request.signal.aborted) {
    abortFromRequestSignal()
  } else {
    input.request.signal.addEventListener('abort', abortFromRequestSignal, { once: true })
  }
  const detachAbortSignals = (): void => {
    input.ownershipSignal?.removeEventListener('abort', abortFromOwnershipSignal)
    input.request.signal.removeEventListener('abort', abortFromRequestSignal)
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
  const approvalPreflightStore = createProjectAgentApprovalPreflightStore()
  const toolset = resolveProjectAgentToolset({
    registry: operations,
    disabledOperationIds: control.kind === 'choice' ? [EDIT_FIRST_CHOICE_TOOL_IDS[control.choiceType]] : [],
  })
  const operationIds = toolset.operationIds
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
    videoRatio: projectConfigSnapshot.videoRatio,
    videoRatioConfirmedAt: projectConfigSnapshot.videoRatioConfirmedAt,
    videoRatioConfirmationVersion: projectConfigSnapshot.videoRatioConfirmationVersion,
    phase,
    creativeWorkingSet,
  })
  const currentPlan = control.kind === 'approval'
    ? null
    : await readProjectAgentPlan({
        projectId: input.projectId,
        userId: input.userId,
        episodeId: context.episodeId || null,
        assistantId: 'workspace-command',
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
        ...(currentPlan ? [buildProjectAgentPlanInputItem(currentPlan)] : []),
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
      billingConfirmationRequired,
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
        operationIds: [...toolset.operationIds],
        disabledOperationIds: [...toolset.disabledOperationIds],
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
      `tools=${String(operationIds.length)}`,
      `editFirstStep=${phase.editFirstWorkflow.step}`,
      `editFirstStatus=${phase.editFirstWorkflow.status.kind}`,
    ].join('\n')))
    initialChunks.push(createDataChunk('data-agent-debug', {
      requestId,
      toolsetSource: toolset.source,
      operationIds: [...operationIds],
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
  const preparedChoiceHandoffs = new Map<string, ProjectAgentChoiceHandoffReceipt>()
  const outcomesByToolCall = new Map<string, ProjectAgentOperationOutcome>()
  const submittedTaskReceiptsByToolCall = new Map<string, ProjectAgentOperationOutcome & { kind: 'submitted_tasks' }>()
  const operationIdByToolCallId = new Map<string, string>()
  let activeOperationBatch = createProjectAgentOperationBatchCoordinator({ originRunId: input.run.id })
  const operationBatch: ProjectAgentOperationBatchCoordinator = {
    claim: (operationId) => activeOperationBatch.claim(operationId),
    readRunFence: () => activeOperationBatch.readRunFence(),
    commitMember: (member) => activeOperationBatch.commitMember(member),
    readMembers: () => activeOperationBatch.readMembers(),
  }
  const sealActiveOperationBatch = async (): Promise<void> => {
    const batchToSeal = activeOperationBatch
    const members = batchToSeal.readMembers()
    if (members.length === 0) {
      if (submittedTaskReceiptsByToolCall.size > 0) {
        throw new Error(
          `PROJECT_AGENT_OPERATION_BATCH_MEMBER_MISSING:${Array.from(submittedTaskReceiptsByToolCall.keys()).sort().join(',')}`,
        )
      }
      activeOperationBatch = createProjectAgentOperationBatchCoordinator({ originRunId: input.run.id })
      return
    }
    for (const member of members) {
      const outcome = submittedTaskReceiptsByToolCall.get(member.toolCallId)
      if (!outcome || outcome.receipt.batchId !== member.receipt.batchId) {
        throw new Error(`PROJECT_AGENT_OPERATION_BATCH_OUTCOME_MISSING:${member.toolCallId}`)
      }
    }
    const memberToolCallIds = new Set(members.map((member) => member.toolCallId))
    const unboundToolCallIds = Array.from(submittedTaskReceiptsByToolCall.keys())
      .filter((toolCallId) => !memberToolCallIds.has(toolCallId))
      .sort()
    if (unboundToolCallIds.length > 0) {
      throw new Error(`PROJECT_AGENT_OPERATION_BATCH_MEMBER_MISSING:${unboundToolCallIds.join(',')}`)
    }
    const firstMember = members[0]
    if (!firstMember) throw new Error('PROJECT_AGENT_OPERATION_BATCH_EMPTY')
    await sealProjectAgentOperationBatchWait({
      projectId: input.projectId,
      userId: input.userId,
      episodeId: context.episodeId ?? null,
      assistantId: 'workspace-command',
      batch: batchToSeal.claim(firstMember.operationId),
      taskIds: Array.from(new Set(members.flatMap((member) => [...member.taskIds]))).sort(),
    })
    for (const member of members) {
      submittedTaskReceiptsByToolCall.delete(member.toolCallId)
    }
    activeOperationBatch = createProjectAgentOperationBatchCoordinator({ originRunId: input.run.id })
  }
  const registerToolCallIdentity = (identity: { toolCallId: string; operationId: string }): void => {
    const toolCallId = identity.toolCallId.trim()
    const operationId = identity.operationId.trim()
    if (!toolCallId || !operationId) throw new Error('PROJECT_AGENT_TOOL_IDENTITY_INVALID')
    const existingOperationId = operationIdByToolCallId.get(toolCallId)
    if (existingOperationId && existingOperationId !== operationId) {
      throw new Error(`PROJECT_AGENT_TOOL_IDENTITY_CONFLICT:${toolCallId}:${existingOperationId}:${operationId}`)
    }
    operationIdByToolCallId.set(toolCallId, operationId)
  }
  if (control.kind === 'approval') {
    const approvalIdentities = persistedApprovalItems.length > 0
      ? persistedApprovalItems
      : [{
          toolCallId: control.interruption.toolCallId,
          operationId: control.interruption.operationId,
        }]
    for (const identity of approvalIdentities) {
      if (!identity.toolCallId) {
        throw new Error(`PROJECT_AGENT_APPROVAL_TOOL_CALL_ID_MISSING:${identity.operationId}`)
      }
      registerToolCallIdentity({
        toolCallId: identity.toolCallId,
        operationId: identity.operationId,
      })
    }
  }
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
      billingConfirmationRequired,
      operationBatch,
      writer: {
        write: (chunk) => {
          sideChannelChunks.push(chunk as unknown as ProjectAgentUiChunk)
        },
        merge: () => {
          throw new Error('PROJECT_AGENT_TOOL_WRITER_MERGE_UNSUPPORTED')
        },
        onError: (error) => (error instanceof Error ? error.message : String(error)),
      },
      onExecutionSettled: ({ toolCallId, outcome }) => {
        if (!toolCallId) {
          throw new Error(`PROJECT_AGENT_TOOL_OUTCOME_CALL_ID_MISSING:${item.operation.id}`)
        }
        if (outcomesByToolCall.has(toolCallId)) {
          throw new Error(`PROJECT_AGENT_TOOL_OUTCOME_DUPLICATE:${item.operation.id}:${toolCallId}`)
        }
        outcomesByToolCall.set(toolCallId, outcome)
        if (outcome.kind === 'submitted_tasks') {
          submittedTaskReceiptsByToolCall.set(toolCallId, outcome)
        }
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
      },
      onToolCallIdentified: registerToolCallIdentity,
      approvalPreflightStore,
    }) as Tool<ProjectAgentAgentsRunContext>
  ))

  const systemPrompt = buildProjectAgentSystemPrompt({
    locale,
    projectId: input.projectId,
    episodeId: context.episodeId || 'unknown',
  })
  const agent = new Agent<ProjectAgentAgentsRunContext>({
    name: 'Project Workspace Agent',
    instructions: systemPrompt,
    model: aisdk(resolved.languageModel as unknown as Parameters<typeof aisdk>[0]),
    modelSettings: {
      parallelToolCalls: true,
    },
    tools,
    toolUseBehavior: async (_runContext, toolResults) => {
      const outcomes = collectFunctionToolOutputs(toolResults, outcomesByToolCall)
      await sealActiveOperationBatch()
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
        // already-approved invocation. The frozen model turn must remain
        // byte-for-byte intact until its approved call has settled.
        return state
      })()
    : agentInput

    const result = await run(agent, runInput, {
      stream: true,
      maxTurns: PROJECT_AGENT_MAX_TURNS,
      context: runContext,
      toolNotFoundBehavior: 'raise_error',
      toolExecution: { maxFunctionToolConcurrency: 1 },
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
      resolveToolName: (toolCallId) => operationIdByToolCallId.get(toolCallId) ?? null,
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
        const shouldPersistApprovalInterruption = approvalItems.length > 0
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
            const primary = members[0]
            if (!primary) throw new Error('PROJECT_AGENT_APPROVAL_GROUP_EMPTY')
            const operationPlan = mergeOperationPlanViewsForApproval(
              primary.operationId,
              members.flatMap((member) => member.operationPlan ? [member.operationPlan] : []),
            )
            return {
              approvalId: primary.approvalId,
              operationId: primary.operationId,
              toolCallId: primary.toolCallId,
              inputHash: primary.inputHash,
              operationPlan,
              members,
              runState: result.state.toString(),
            }
          })()
          : null

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
          if (latestStopPart?.reason === 'awaiting_user_confirmation') {
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
        const clientDisconnect = readProjectAgentClientDisconnect(runAbortController.signal)
        const effectiveError = ownershipLoss ?? clientDisconnect ?? error
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
          clientDisconnect,
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
          detachAbortSignals()
          await stopHeartbeatOnce()
          await releaseRunLockOnce()
        }
      },
    })
    const response = createUIMessageStreamResponse({ stream })
    response.headers.set('x-request-id', stableRequestId)
    return response
  } catch (error) {
    detachAbortSignals()
    await stopHeartbeatOnce()
    try {
      if (!input.settleTaskFollowUp) {
        const ownershipLoss = readProjectAgentRunOwnershipLoss(runAbortController.signal)
        const clientDisconnect = readProjectAgentClientDisconnect(runAbortController.signal)
        const terminal = resolveProjectAgentRunFailureTerminal({
          ownershipLoss,
          clientDisconnect,
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
