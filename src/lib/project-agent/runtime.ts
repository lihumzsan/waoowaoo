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
  type RunStreamEvent,
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
import {
  readCreativeResourceMaterializedRefs,
  readProjectCreativeResourceLinkViews,
} from '@/lib/creative-resource/assistant-link-view'
import type { CreativeResourceMaterializedRef } from '@/lib/creative-resource/contracts'
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
  ProjectAgentContextCompactedPartData,
  ProjectAgentInterruptionPartData,
  ProjectAgentInterruptionResolvedPartData,
  ProjectAgentResourceLinksPartData,
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
import {
  buildProjectAgentContextComposition,
  buildProjectAgentContextTelemetry,
  measureProjectAgentToolSchemas,
} from './context-telemetry'
import { decideProjectAgentModelInput } from './model-input/filter'
import { compactProjectAgentConversation } from './model-input/compaction'
import { estimateProjectAgentTokens } from './model-input/estimate'
import {
  resolveProjectAgentAssistantModelKey,
  resolveProjectAgentLanguageModel,
} from './model'
import { buildAiExecutionSessionId } from '@/lib/ai-exec/session'
import { createAgentsPublicReasoningNormalizer } from '@/lib/ai-exec/agents-public-reasoning'
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
import type { ProjectAgentChoiceResult } from './choice-result'
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
import {
  PROJECT_AGENT_OPERATION_GATEWAY_NAME,
  PROJECT_AGENT_TOOL_DISCOVERY_NAME,
  buildProjectAgentOperationGatewayDescription,
  createProjectAgentToolCatalog,
  createProjectAgentToolDiscoveryState,
  createProjectAgentToolDiscoveryTool,
  formatProjectAgentToolNotFound,
} from './tool-discovery'
import {
  createProjectAgentOperationTools,
  readProjectAgentOperationGatewayInput,
  readProjectAgentOperationGatewayOperationId,
} from './agents-tool-adapter'
import {
  PROJECT_AGENT_MAX_TURNS,
  createProjectAgentStopController,
} from './stop-conditions'
import {
  createDataChunk,
  createProjectAgentSideChannel,
  createProjectAgentUiMessageStream,
  type ProjectAgentUiChunk,
} from './agents-ui-stream'
import {
  appendProjectAssistantTextAttachmentsToUserText,
  readProjectAssistantTextAttachmentsFromMessage,
} from './text-attachments'
import { appendProjectAssistantThreadMessages } from './persistence'
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
 * current Choice-eligible Operation already committed by the Choice
 * transaction, when applicable. Follow-up work is a fresh Primary decision.
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
    toolCallId: string | null
    cardId: string | null
    appliedOperationId: string | null
    choiceResult: ProjectAgentChoiceResult
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

function readTaskFollowUpResourceRefs(
  followUp: ProjectAgentWaitFollowUp,
  assistantPresentation: 'none' | 'created_resources',
): CreativeResourceMaterializedRef[] {
  if (assistantPresentation !== 'created_resources') return []
  return followUp.completedTasks.flatMap((task) => {
    if (!task.result || !Array.isArray(task.result.resources)) return []
    return readCreativeResourceMaterializedRefs(task.result)
  })
}

function formatRuntimeStateValue(value: string | null | undefined): string {
  const normalized = value?.trim().replace(/\s+/g, ' ') ?? ''
  return normalized || 'none'
}

interface ProjectRuntimeFacts {
  planning: {
    storyCanonVersion: number | null
    screenplayRevisionId: string | null
    storyCanonRevisionId: string | null
    chapterCount: number
  }
}

async function readProjectRuntimeFacts(params: {
  projectId: string
  userId: string
  episodeId: string | null
}): Promise<ProjectRuntimeFacts> {
  const [storyCanon, chapterCount] = await Promise.all([
    params.episodeId
      ? prisma.projectStoryCanon.findFirst({
          where: {
            episodeId: params.episodeId,
            episode: {
              projectId: params.projectId,
              project: { userId: params.userId },
            },
          },
          select: {
            version: true,
            storyCanonRevisionId: true,
            sourceDocument: {
              select: { sourceRevisionId: true },
            },
          },
        })
      : Promise.resolve(null),
    params.episodeId
      ? prisma.projectEditChapter.count({
          where: {
            episodeId: params.episodeId,
            episode: {
              projectId: params.projectId,
              project: { userId: params.userId },
            },
          },
        })
      : Promise.resolve(0),
  ])
  return {
    planning: {
      storyCanonVersion: storyCanon?.version ?? null,
      screenplayRevisionId: storyCanon?.sourceDocument.sourceRevisionId ?? null,
      storyCanonRevisionId: storyCanon?.storyCanonRevisionId ?? null,
      chapterCount,
    },
  }
}

function buildProjectStateVersion(params: {
  videoRatio: string | null
  facts: ProjectRuntimeFacts
  creativeWorkingSet: CreativeResourceWorkingSetView
}): string {
  return [
    params.videoRatio ?? 'none',
    String(params.facts.planning.storyCanonVersion ?? 'none'),
    params.facts.planning.screenplayRevisionId ?? 'none',
    params.facts.planning.storyCanonRevisionId ?? 'none',
    String(params.facts.planning.chapterCount),
    params.creativeWorkingSet.adoptedCreativeDirection?.revisionId ?? 'none',
    ...params.creativeWorkingSet.bindings.map((binding) => `${binding.bindingId}:${String(binding.version)}`),
  ].map(formatRuntimeStateValue).join(':')
}

function buildProjectStateInputItem(params: {
  projectId: string
  episodeId: string | null
  videoRatio: string | null
  facts: ProjectRuntimeFacts
  creativeWorkingSet: CreativeResourceWorkingSetView
}): AgentInputItem {
  const lines = [
    '[project_state_snapshot]',
    `version=${buildProjectStateVersion({
      videoRatio: params.videoRatio,
      facts: params.facts,
      creativeWorkingSet: params.creativeWorkingSet,
    })}`,
    `projectId=${formatRuntimeStateValue(params.projectId)}`,
    `episodeId=${formatRuntimeStateValue(params.episodeId)}`,
    `config.videoRatio=${formatRuntimeStateValue(params.videoRatio)}`,
    `planning.storyCanonVersion=${formatRuntimeStateValue(String(params.facts.planning.storyCanonVersion ?? 'none'))}`,
    `planning.screenplayRevisionId=${formatRuntimeStateValue(params.facts.planning.screenplayRevisionId)}`,
    `planning.storyCanonRevisionId=${formatRuntimeStateValue(params.facts.planning.storyCanonRevisionId)}`,
    `planning.chapterCount=${String(params.facts.planning.chapterCount)}`,
    `creativeWorkingSet.adoptedCreativeDirection=${JSON.stringify(params.creativeWorkingSet.adoptedCreativeDirection)}`,
    `creativeWorkingSet.adoptedAssetManifest=${JSON.stringify(params.creativeWorkingSet.adoptedAssetManifest)}`,
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
  operationIdByToolCallId: ReadonlyMap<string, string>,
): Array<{ toolCallId: string; toolName: string; outcome: ProjectAgentOperationOutcome }> {
  return toolResults.flatMap((result) => {
    if (result.type !== 'function_output') return []
    if (result.tool.name === PROJECT_AGENT_TOOL_DISCOVERY_NAME) return []
    const toolCallId = readApprovalString(result.runItem.rawItem, 'callId')
      ?? readApprovalString(result.runItem.rawItem, 'id')
    if (!toolCallId) {
      throw new Error(`PROJECT_AGENT_TOOL_OUTCOME_CALL_ID_MISSING:${result.tool.name}`)
    }
    const outcome = outcomesByToolCall.get(toolCallId)
    if (!outcome) {
      throw new Error(`PROJECT_AGENT_TOOL_OUTCOME_MISSING:${result.tool.name}:${toolCallId}`)
    }
    const operationId = operationIdByToolCallId.get(toolCallId)
    if (!operationId) {
      throw new Error(`PROJECT_AGENT_TOOL_IDENTITY_MISSING:${toolCallId}`)
    }
    outcomesByToolCall.delete(toolCallId)
    return [{
      toolCallId,
      toolName: operationId,
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
  operation: ProjectAgentOperationRegistry[string] | undefined
  toolCallId: string | null
  input: unknown
  approvalPreflightStore: ProjectAgentApprovalPreflightStore
}): Promise<OperationPlanView | null> {
  if (!params.operation?.plan) return null
  const operationPlan = params.approvalPreflightStore.getPlanned({
    operationId: params.operation.id,
    toolCallId: params.toolCallId,
    input: params.input,
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
  const [runtimeFacts, projectConfigSnapshot, creativeWorkingSet] = await Promise.all([
    readProjectRuntimeFacts({
      projectId: input.projectId,
      userId: input.userId,
      episodeId: context.episodeId || null,
    }),
    prisma.project.findFirst({
      where: { id: input.projectId, userId: input.userId },
      select: {
        videoRatio: true,
      },
    }),
    readProjectCreativeResourceWorkingSet({
      projectId: input.projectId,
      userId: input.userId,
      episodeId: context.episodeId || null,
    }),
  ])
  if (!projectConfigSnapshot) throw new Error(`PROJECT_AGENT_PROJECT_NOT_FOUND:${input.projectId}`)
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
    promptCacheHorizon: 'conversation',
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
    const runtimeMessages = normalizedMessages

  const agentDebug = new URL(input.request.url).searchParams.get('agentDebug') === '1'
  const operations = createProjectAgentOperationRegistry()
  const approvalInterruption = control.kind === 'approval' ? control.interruption : null
  const approvalPreflightStore = createProjectAgentApprovalPreflightStore()
  const toolset = resolveProjectAgentToolset({
    registry: operations,
    disabledOperationIds: [],
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
  const toolCatalog = createProjectAgentToolCatalog({
    registry: operations,
    toolset,
    describeOperation: (operationId, fallback) => (
      localizeSelectableToolDescription(operationId, fallback, locale)
    ),
  })
  const initiallyLoadedOperationIds = control.kind === 'approval'
    ? Array.from(new Set(
        (persistedApprovalItems.length > 0
          ? persistedApprovalItems.map((item) => item.operationId)
          : [control.interruption.operationId])
          .filter((operationId) => operations[operationId]?.toolExposure === 'on_demand'),
      ))
    : []
  const toolDiscoveryState = createProjectAgentToolDiscoveryState({
    catalog: toolCatalog,
    initiallyLoadedOperationIds,
  })
  const projectStateInputItem = buildProjectStateInputItem({
    projectId: input.projectId,
    episodeId: context.episodeId || null,
    videoRatio: projectConfigSnapshot.videoRatio,
    facts: runtimeFacts,
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

  // Conversation only grows between turns, so it is compacted here rather than
  // inside the per-step filter: summarising mid-run would rewrite a prefix the
  // provider is still caching for the steps that follow.
  const compaction = control.kind === 'approval'
    ? null
    : await compactProjectAgentConversation({
        projectId: input.projectId,
        userId: input.userId,
        episodeId: context.episodeId || null,
        assistantId: 'workspace-command',
        locale,
        messages: runtimeMessages,
        signal: runAbortController.signal,
        onFailure: (error) => {
          projectAgentLogger.warn({
            action: 'assistant.context.summary_failed',
            message: 'Conversation summary failed; continuing without compaction',
            requestId,
            projectId: input.projectId,
            userId: input.userId,
            error,
          })
        },
      })
  const compactedMessages = compaction?.messages ?? runtimeMessages
  const conversationInputItems: AgentInputItem[] = control.kind === 'approval'
    ? []
    : [
        ...(compaction?.summaryInputItem ? [compaction.summaryInputItem] : []),
        ...(control.kind === 'user_turn'
          ? withDeclinedApprovalsNote(
              toAgentInputItems(compactedMessages, locale),
              buildDeclinedApprovalsInputItem(control.declinedInterruptions),
            )
          : toAgentInputItems(compactedMessages, locale)),
      ]
  const agentPlanInputItem = currentPlan ? buildProjectAgentPlanInputItem(currentPlan) : null
  const agentInput: AgentInputItem[] = control.kind === 'approval'
    ? []
    : [
        ...conversationInputItems,
        ...(control.kind === 'choice' ? control.choiceResult.inputItems : []),
        ...(control.kind === 'task_follow_up' ? [buildTaskFollowUpInputItem(control.followUp)] : []),
        projectStateInputItem,
        ...(agentPlanInputItem ? [agentPlanInputItem] : []),
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
        directOperationIds: [...toolset.directOperationIds],
        onDemandOperationIds: [...toolset.onDemandOperationIds],
        disabledOperationIds: [...toolset.disabledOperationIds],
      },
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
  if (compaction?.compacted) {
    initialChunks.push(createDataChunk('data-assistant-context-compacted', {
      runId: input.run.id,
      summarizedMessageCount: compaction.compacted.summarizedMessageCount,
      summaryText: compaction.compacted.summaryText,
    } satisfies ProjectAgentContextCompactedPartData))
  }
  if (control.kind === 'choice') {
    initialChunks.push(createDataChunk('data-assistant-choice-resolved', {
      runId: input.run.id,
      interruptionId: control.interruptionId,
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
      `chapterCount=${String(runtimeFacts.planning.chapterCount)}`,
      `storyCanonVersion=${String(runtimeFacts.planning.storyCanonVersion ?? 'none')}`,
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
      runtimeFacts,
      toolset,
      toolDiscovery: {
        toolName: PROJECT_AGENT_TOOL_DISCOVERY_NAME,
        catalogSize: toolCatalog.length,
        initiallyLoadedOperationIds: toolDiscoveryState.loadedOperationIds(),
      },
    },
  })

  let latestStopPart: ProjectAgentStopPartData | null = null
  const preparedChoiceHandoffs = new Map<string, ProjectAgentChoiceHandoffReceipt>()
  const outcomesByToolCall = new Map<string, ProjectAgentOperationOutcome>()
  const completedResourceRefs: CreativeResourceMaterializedRef[] = []
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
  const sideChannel = createProjectAgentSideChannel()
  const operationTools = createProjectAgentOperationTools({
    request: input.request,
    registry: operations,
    discoveryState: toolDiscoveryState,
    description: buildProjectAgentOperationGatewayDescription(locale),
    directOperations: toolset.directOperationIds.map((operationId) => {
      const operation = operations[operationId]
      if (!operation) {
        throw new Error(`PROJECT_AGENT_OPERATION_NOT_FOUND operationId=${operationId}`)
      }
      return {
        operation,
        description: toolDescriptions.get(operationId) ?? operation.summary,
      }
    }),
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
        sideChannel.write({
          kind: 'chunk',
          chunk: chunk as unknown as ProjectAgentUiChunk,
        })
      },
      merge: () => {
        throw new Error('PROJECT_AGENT_TOOL_WRITER_MERGE_UNSUPPORTED')
      },
      onError: (error) => (error instanceof Error ? error.message : String(error)),
    },
    onExecutionSettled: ({ toolCallId, operationId, outcome }) => {
      if (!toolCallId) {
        throw new Error(`PROJECT_AGENT_TOOL_OUTCOME_CALL_ID_MISSING:${operationId}`)
      }
      if (outcomesByToolCall.has(toolCallId)) {
        throw new Error(`PROJECT_AGENT_TOOL_OUTCOME_DUPLICATE:${operationId}:${toolCallId}`)
      }
      outcomesByToolCall.set(toolCallId, outcome)
      const resourceContract = operations[operationId]?.resourceContract
      if (
        outcome.kind === 'completed'
        && resourceContract?.kind === 'resource'
        && resourceContract.assistantPresentation === 'created_resources'
      ) {
        // 链接是已持久化 Operation 结果的只读展示投影;形状异常记录错误并跳过该结果,
        // 不允许把展示层失败升级为整轮 chat response 失败(权威事实仍在 Task/Resource)。
        try {
          completedResourceRefs.push(...readCreativeResourceMaterializedRefs(outcome.data))
        } catch (error) {
          projectAgentLogger.error({
            action: 'assistant.resource_links.refs_invalid',
            message: 'created_resources outcome could not be projected into links',
            details: {
              operationId,
              toolCallId,
              error: error instanceof Error ? error.message : String(error),
            },
          })
        }
      }
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
  }) as unknown as Tool<ProjectAgentAgentsRunContext>[]
  const tools: Tool<ProjectAgentAgentsRunContext>[] = [
    createProjectAgentToolDiscoveryTool<ProjectAgentAgentsRunContext>({
      state: toolDiscoveryState,
      locale,
    }),
    ...operationTools,
  ]

  const systemPrompt = buildProjectAgentSystemPrompt({
    locale,
    projectId: input.projectId,
    episodeId: context.episodeId || 'unknown',
  })
  const toolSchemaMeasurement = measureProjectAgentToolSchemas(tools)
  const contextComposition = buildProjectAgentContextComposition({
    instructions: systemPrompt,
    toolSchemas: toolSchemaMeasurement,
    conversation: conversationInputItems,
    projectState: projectStateInputItem,
    agentPlan: agentPlanInputItem,
  })
  const modelInputFilterConfig = {
    modelKey: assistantModelKey,
    toolSchemaTokens: estimateProjectAgentTokens(toolSchemaMeasurement),
    locale,
    // Enumerated from the production registry so a new Operation whose result
    // cannot be re-fetched is protected by declaring it, not by editing a
    // second list here.
    irreplaceableToolNames: new Set(
      Object.values(operations)
        .filter((operation) => operation.modelResultRetention === 'irreplaceable')
        .map((operation) => operation.id),
    ),
  }
  let latestModelInputDecision: ReturnType<typeof decideProjectAgentModelInput> | null = null
  const agent = new Agent<ProjectAgentAgentsRunContext>({
    name: 'Project Workspace Agent',
    instructions: systemPrompt,
    model: aisdk(resolved.languageModel as unknown as Parameters<typeof aisdk>[0]),
    modelSettings: {
      parallelToolCalls: true,
    },
    tools,
    toolUseBehavior: async (_runContext, toolResults) => {
      const outcomes = collectFunctionToolOutputs(
        toolResults,
        outcomesByToolCall,
        operationIdByToolCallId,
      )
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
      toolNotFoundBehavior: 'return_error_to_model',
      toolErrorFormatter: ({ kind, toolName }) => (
        kind === 'tool_not_found'
          ? formatProjectAgentToolNotFound({
              toolName,
              catalog: toolCatalog,
              locale,
            })
          : undefined
      ),
      toolExecution: { maxFunctionToolConcurrency: 1 },
      // Runs before every model request, including the ones a restored run
      // state produces, so approval resume is governed by the same authority
      // as an initial turn. It rewrites only the outgoing payload; the
      // serialised state stays byte-identical.
      callModelInputFilter: ({ modelData }) => {
        const decision = decideProjectAgentModelInput(modelInputFilterConfig, modelData)
        latestModelInputDecision = decision
        return {
          input: decision.input,
          ...(decision.instructions === undefined ? {} : { instructions: decision.instructions }),
        }
      },
      signal: runAbortController.signal,
    })
    const publicReasoning = createAgentsPublicReasoningNormalizer()
    const writePublicReasoning = (
      event: ReturnType<typeof publicReasoning.accept>[number],
    ): void => {
      if (event.kind === 'start') {
        sideChannel.write({
          kind: 'public_reasoning',
          phase: 'start',
          reasoningId: event.reasoningId,
          chunk: {
            type: 'reasoning-start',
            id: event.reasoningId,
          } as ProjectAgentUiChunk,
        })
        return
      }
      if (event.kind === 'delta') {
        sideChannel.write({
          kind: 'public_reasoning',
          phase: 'delta',
          reasoningId: event.reasoningId,
          chunk: {
            type: 'reasoning-delta',
            id: event.reasoningId,
            delta: event.delta,
          } as ProjectAgentUiChunk,
        })
        return
      }
      sideChannel.write({
        kind: 'public_reasoning',
        phase: 'end',
        reasoningId: event.reasoningId,
        completedText: event.text,
        chunk: {
          type: 'reasoning-end',
          id: event.reasoningId,
        } as ProjectAgentUiChunk,
      })
    }
    const observedRunSource = (async function* (): AsyncGenerator<RunStreamEvent> {
      try {
        for await (const event of result) {
          if (
            event.type === 'run_item_stream_event'
            && event.name === 'tool_called'
            && event.item.type === 'tool_call_item'
            && event.item.rawItem.type === 'function_call'
          ) {
            const operationId = event.item.rawItem.name === PROJECT_AGENT_OPERATION_GATEWAY_NAME
              ? readProjectAgentOperationGatewayOperationId(
                  JSON.parse(event.item.rawItem.arguments) as unknown,
                )
              : toolset.directOperationIds.includes(event.item.rawItem.name)
                ? event.item.rawItem.name
                : null
            if (operationId) {
              registerToolCallIdentity({
                toolCallId: event.item.rawItem.callId,
                operationId,
              })
            }
          }
          for (const reasoningEvent of publicReasoning.accept(event)) {
            writePublicReasoning(reasoningEvent)
          }
          yield event
        }
      } finally {
        for (const reasoningEvent of publicReasoning.finish()) {
          writePublicReasoning(reasoningEvent)
        }
      }
    })()
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
    const recordedAssistantChunks = new WeakSet<object>()
    const recordAssistantChunk = (chunk: ProjectAgentUiChunk): void => {
      if ((chunk as { type?: unknown }).type === 'finish') return
      if (typeof chunk === 'object' && chunk !== null) {
        if (recordedAssistantChunks.has(chunk)) return
        recordedAssistantChunks.add(chunk)
      }
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
      source: observedRunSource,
      initialChunks,
      resolveToolName: (toolCallId) => operationIdByToolCallId.get(toolCallId) ?? null,
      availableToolNames: tools.map((tool) => tool.name),
      hiddenToolNames: [PROJECT_AGENT_TOOL_DISCOVERY_NAME],
      aliasedToolNames: [PROJECT_AGENT_OPERATION_GATEWAY_NAME],
      sideChannel,
      onChunk: recordAssistantChunk,
      beforeFinish: async () => {
        const chunks: ProjectAgentUiChunk[] = []
        let completionError: unknown = null
        try {
          await result.completed
        } catch (error) {
          completionError = error
        }

        projectAgentLogger.info({
          action: 'assistant.context.usage',
          message: 'Project agent model context usage',
          requestId,
          projectId: input.projectId,
          userId: input.userId,
          details: {
            runId: input.run.id,
            executionSegmentId: executionSegment.id,
            control: control.kind,
            modelKey: assistantModelKey,
            budget: latestModelInputDecision
              ? {
                availableInputTokens: latestModelInputDecision.budget?.availableInputTokens ?? null,
                estimatedInputTokens: latestModelInputDecision.estimatedInputTokens,
                overBudget: latestModelInputDecision.overBudget,
                clearedResultCount: latestModelInputDecision.clearedResultCount,
                freedTokens: latestModelInputDecision.freedTokens,
              }
              : null,
            ...buildProjectAgentContextTelemetry({
              composition: contextComposition,
              usage: runContext.usage,
            }),
          },
        })

        const approvalItems = result.interruptions.length > 0
          ? result.interruptions
          : result.state.getInterruptions()
        const shouldPersistApprovalInterruption = approvalItems.length > 0
        const pendingApprovalHandoff = shouldPersistApprovalInterruption
          ? await (async () => {
            const members = await Promise.all(approvalItems.map(async (approvalItem) => {
              const approvalId = readApprovalId(approvalItem)
              const toolCallId = readApprovalToolCallId(approvalItem)
              const invocation = readProjectAgentOperationGatewayInput(readApprovalInput(approvalItem))
              const operationId = invocation.operationId
              const identifiedOperationId = toolCallId
                ? operationIdByToolCallId.get(toolCallId) ?? null
                : null
              if (identifiedOperationId && identifiedOperationId !== operationId) {
                throw new Error(
                  `PROJECT_AGENT_APPROVAL_OPERATION_IDENTITY_CONFLICT:${toolCallId}:${identifiedOperationId}:${operationId}`,
                )
              }
              const operationPlan = await buildApprovalOperationPlanView({
                operation: operations[operationId],
                toolCallId,
                input: invocation.arguments,
                approvalPreflightStore,
              })
              return {
                approvalId,
                operationId,
                toolCallId,
                inputHash: operationPlan?.inputHash ?? stableArgsHash(invocation.arguments),
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
        const followUpResourceContract = control.kind === 'task_follow_up'
          ? operations[control.followUp.operationId]?.resourceContract
          : null
        const resourceRefs = [
          ...(control.kind === 'task_follow_up'
            ? readTaskFollowUpResourceRefs(
                control.followUp,
                followUpResourceContract?.kind === 'resource'
                  ? followUpResourceContract.assistantPresentation
                  : 'none',
              )
            : []),
          ...completedResourceRefs,
        ]
        if (resourceRefs.length > 0) {
          // DB 回读竞态(revision 未 ready/已删除)同样只降级为"本轮不显示链接",不失败整轮。
          try {
            const resources = await readProjectCreativeResourceLinkViews({
              projectId: input.projectId,
              userId: input.userId,
              refs: resourceRefs,
            })
            const resourceLinksChunk = createDataChunk('data-assistant-resource-links', {
              resources,
            } satisfies ProjectAgentResourceLinksPartData)
            recordAssistantChunk(resourceLinksChunk)
            chunks.push(resourceLinksChunk)
          } catch (error) {
            projectAgentLogger.error({
              action: 'assistant.resource_links.view_failed',
              message: 'resource link views could not be read; links omitted for this turn',
              details: {
                refCount: resourceRefs.length,
                error: error instanceof Error ? error.message : String(error),
              },
            })
          }
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
            runtimeFacts,
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
