import { safeValidateUIMessages, type UIMessage } from 'ai'
import type { OperationPlanView } from '@/lib/operations/planning'
import type { ProjectAgentSubagentView } from '@/lib/project-agent/subagent-events'
import type { ProjectAgentPlanSnapshot } from '@/lib/project-agent/plan'
import type { ProjectAgentChoiceCardDefinition } from '@/lib/project-agent/choice-offer'
import {
  AGENT_TURN_SOURCE_KIND,
  type AgentTurnSourceKind,
  type AgentTurnStatus,
} from './contracts'
import { TASK_STATUS, type TaskStatus } from '@/lib/task/types'

export interface AgentSessionViewScope {
  projectId: string
  userId: string
  episodeId: string | null
  assistantId: 'workspace-command'
}

export interface AgentSessionTurnView {
  turnId: string
  requestId: string
  sourceKind: AgentTurnSourceKind
  sourceId: string
  status: AgentTurnStatus
  attempt: number
  assistantMessageId: string | null
  stopReason: string | null
  errorCode: string | null
  errorMessage: string | null
  cancelReason: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

export type AgentSessionPendingInteractionView =
  | {
      kind: 'approval'
      interactionId: string
      turnId: string
      version: number
      members: readonly {
        approvalId: string
        callId: string
        operationId: string
        operationPlan: OperationPlanView | null
      }[]
      createdAt: string
    }
  | {
      kind: 'choice'
      interactionId: string
      turnId: string
      version: number
      operationId: string
      callId: string
      card: ProjectAgentChoiceCardDefinition
      createdAt: string
    }

export interface AgentSessionTaskView {
  taskId: string
  operationId: string | null
  taskType: string
  targetType: string
  targetId: string
  status: TaskStatus
  terminal: boolean
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  finishedAt: string | null
}

export type AgentSessionFollowUpBatchStatus =
  | 'pending'
  | 'ready'
  | 'notified'
  | 'cancelled'

export interface AgentSessionFollowUpBatchView {
  batchId: string
  originTurnId: string
  callId: string
  operationId: string
  status: AgentSessionFollowUpBatchStatus
  notifiedTurnId: string | null
  tasks: readonly AgentSessionTaskView[]
  progress: {
    total: number
    terminal: number
    failed: number
    cancelled: number
  }
  createdAt: string
  readyAt: string | null
  notifiedAt: string | null
  cancelledAt: string | null
}

export interface AgentSessionSubagentView extends ProjectAgentSubagentView {
  anchorMessageId: string | null
}

export interface AgentSessionView {
  protocol: 'agent_session_view_v1'
  scope: AgentSessionViewScope
  thread: {
    threadId: string
    messages: readonly UIMessage[]
    plan: ProjectAgentPlanSnapshot | null
    modelHistoryVersion: number
    createdAt: string
    updatedAt: string
  } | null
  currentTurn: AgentSessionTurnView | null
  queuedTurns: readonly AgentSessionTurnView[]
  recentTurns: readonly AgentSessionTurnView[]
  pendingInteraction: AgentSessionPendingInteractionView | null
  followUpBatches: readonly AgentSessionFollowUpBatchView[]
  subagents: readonly AgentSessionSubagentView[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function requireRecord(value: unknown, code: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(code)
  return value
}

function requireString(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw new Error(code)
  }
  return value
}

function requireNullableString(value: unknown, code: string): string | null {
  return value === null ? null : requireString(value, code)
}

function requireInteger(
  value: unknown,
  code: string,
  minimum = 0,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(code)
  }
  return value as number
}

function requireBoolean(value: unknown, code: string): boolean {
  if (typeof value !== 'boolean') throw new Error(code)
  return value
}

function requireArray(value: unknown, code: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(code)
  return value
}

function requireTimestamp(value: unknown, code: string): string {
  const text = requireString(value, code)
  if (!Number.isFinite(Date.parse(text))) throw new Error(code)
  return text
}

function requireNullableTimestamp(
  value: unknown,
  code: string,
): string | null {
  return value === null ? null : requireTimestamp(value, code)
}

function parseTurnStatus(value: unknown): AgentTurnStatus {
  if (
    value === 'queued'
    || value === 'running'
    || value === 'waiting_approval'
    || value === 'completed'
    || value === 'failed'
    || value === 'interrupted'
    || value === 'cancelled'
  ) {
    return value
  }
  throw new Error('AGENT_SESSION_VIEW_TURN_STATUS_INVALID')
}

function parseSourceKind(value: unknown): AgentTurnSourceKind {
  if (
    value === AGENT_TURN_SOURCE_KIND.USER
    || value === AGENT_TURN_SOURCE_KIND.TASK_FOLLOW_UP
    || value === AGENT_TURN_SOURCE_KIND.CHOICE_RESPONSE
  ) {
    return value
  }
  throw new Error('AGENT_SESSION_VIEW_SOURCE_KIND_INVALID')
}

function parseTaskStatus(value: unknown): TaskStatus {
  if (
    value === TASK_STATUS.QUEUED
    || value === TASK_STATUS.PROCESSING
    || value === TASK_STATUS.COMPLETED
    || value === TASK_STATUS.FAILED
    || value === TASK_STATUS.CANCELED
    || value === TASK_STATUS.DISMISSED
  ) {
    return value
  }
  throw new Error('AGENT_SESSION_VIEW_TASK_STATUS_INVALID')
}

function parseTurn(value: unknown): AgentSessionTurnView {
  const record = requireRecord(value, 'AGENT_SESSION_VIEW_TURN_INVALID')
  return {
    turnId: requireString(record.turnId, 'AGENT_SESSION_VIEW_TURN_ID_INVALID'),
    requestId: requireString(
      record.requestId,
      'AGENT_SESSION_VIEW_TURN_REQUEST_ID_INVALID',
    ),
    sourceKind: parseSourceKind(record.sourceKind),
    sourceId: requireString(
      record.sourceId,
      'AGENT_SESSION_VIEW_TURN_SOURCE_ID_INVALID',
    ),
    status: parseTurnStatus(record.status),
    attempt: requireInteger(
      record.attempt,
      'AGENT_SESSION_VIEW_TURN_ATTEMPT_INVALID',
    ),
    assistantMessageId: requireNullableString(
      record.assistantMessageId,
      'AGENT_SESSION_VIEW_TURN_MESSAGE_ID_INVALID',
    ),
    stopReason: requireNullableString(
      record.stopReason,
      'AGENT_SESSION_VIEW_TURN_STOP_REASON_INVALID',
    ),
    errorCode: requireNullableString(
      record.errorCode,
      'AGENT_SESSION_VIEW_TURN_ERROR_CODE_INVALID',
    ),
    errorMessage: requireNullableString(
      record.errorMessage,
      'AGENT_SESSION_VIEW_TURN_ERROR_MESSAGE_INVALID',
    ),
    cancelReason: requireNullableString(
      record.cancelReason,
      'AGENT_SESSION_VIEW_TURN_CANCEL_REASON_INVALID',
    ),
    startedAt: requireNullableTimestamp(
      record.startedAt,
      'AGENT_SESSION_VIEW_TURN_STARTED_AT_INVALID',
    ),
    finishedAt: requireNullableTimestamp(
      record.finishedAt,
      'AGENT_SESSION_VIEW_TURN_FINISHED_AT_INVALID',
    ),
    createdAt: requireTimestamp(
      record.createdAt,
      'AGENT_SESSION_VIEW_TURN_CREATED_AT_INVALID',
    ),
    updatedAt: requireTimestamp(
      record.updatedAt,
      'AGENT_SESSION_VIEW_TURN_UPDATED_AT_INVALID',
    ),
  }
}

function parsePendingInteraction(
  value: unknown,
): AgentSessionPendingInteractionView | null {
  if (value === null) return null
  const record = requireRecord(
    value,
    'AGENT_SESSION_VIEW_INTERACTION_INVALID',
  )
  const common = {
    interactionId: requireString(
      record.interactionId,
      'AGENT_SESSION_VIEW_INTERACTION_ID_INVALID',
    ),
    turnId: requireString(
      record.turnId,
      'AGENT_SESSION_VIEW_INTERACTION_TURN_ID_INVALID',
    ),
    version: requireInteger(
      record.version,
      'AGENT_SESSION_VIEW_INTERACTION_VERSION_INVALID',
    ),
    createdAt: requireTimestamp(
      record.createdAt,
      'AGENT_SESSION_VIEW_INTERACTION_CREATED_AT_INVALID',
    ),
  }
  if (record.kind === 'approval') {
    const members = requireArray(
      record.members,
      'AGENT_SESSION_VIEW_APPROVAL_MEMBERS_INVALID',
    ).map((value) => {
      const member = requireRecord(
        value,
        'AGENT_SESSION_VIEW_APPROVAL_MEMBER_INVALID',
      )
      return {
        approvalId: requireString(
          member.approvalId,
          'AGENT_SESSION_VIEW_APPROVAL_ID_INVALID',
        ),
        callId: requireString(
          member.callId,
          'AGENT_SESSION_VIEW_APPROVAL_CALL_ID_INVALID',
        ),
        operationId: requireString(
          member.operationId,
          'AGENT_SESSION_VIEW_APPROVAL_OPERATION_ID_INVALID',
        ),
        operationPlan:
          member.operationPlan === null
            ? null
            : requireRecord(
                member.operationPlan,
                'AGENT_SESSION_VIEW_APPROVAL_PLAN_INVALID',
              ) as unknown as OperationPlanView,
      }
    })
    if (members.length === 0) {
      throw new Error('AGENT_SESSION_VIEW_APPROVAL_MEMBERS_EMPTY')
    }
    return { kind: 'approval', ...common, members }
  }
  if (record.kind === 'choice') {
    return {
      kind: 'choice',
      ...common,
      operationId: requireString(
        record.operationId,
        'AGENT_SESSION_VIEW_CHOICE_OPERATION_ID_INVALID',
      ),
      callId: requireString(
        record.callId,
        'AGENT_SESSION_VIEW_CHOICE_CALL_ID_INVALID',
      ),
      card: requireRecord(
        record.card,
        'AGENT_SESSION_VIEW_CHOICE_CARD_INVALID',
      ) as unknown as ProjectAgentChoiceCardDefinition,
    }
  }
  throw new Error('AGENT_SESSION_VIEW_INTERACTION_KIND_INVALID')
}

function parseTask(value: unknown): AgentSessionTaskView {
  const record = requireRecord(value, 'AGENT_SESSION_VIEW_TASK_INVALID')
  return {
    taskId: requireString(record.taskId, 'AGENT_SESSION_VIEW_TASK_ID_INVALID'),
    operationId: requireNullableString(
      record.operationId,
      'AGENT_SESSION_VIEW_TASK_OPERATION_ID_INVALID',
    ),
    taskType: requireString(
      record.taskType,
      'AGENT_SESSION_VIEW_TASK_TYPE_INVALID',
    ),
    targetType: requireString(
      record.targetType,
      'AGENT_SESSION_VIEW_TASK_TARGET_TYPE_INVALID',
    ),
    targetId: requireString(
      record.targetId,
      'AGENT_SESSION_VIEW_TASK_TARGET_ID_INVALID',
    ),
    status: parseTaskStatus(record.status),
    terminal: requireBoolean(
      record.terminal,
      'AGENT_SESSION_VIEW_TASK_TERMINAL_INVALID',
    ),
    errorCode: requireNullableString(
      record.errorCode,
      'AGENT_SESSION_VIEW_TASK_ERROR_CODE_INVALID',
    ),
    errorMessage: requireNullableString(
      record.errorMessage,
      'AGENT_SESSION_VIEW_TASK_ERROR_MESSAGE_INVALID',
    ),
    createdAt: requireTimestamp(
      record.createdAt,
      'AGENT_SESSION_VIEW_TASK_CREATED_AT_INVALID',
    ),
    finishedAt: requireNullableTimestamp(
      record.finishedAt,
      'AGENT_SESSION_VIEW_TASK_FINISHED_AT_INVALID',
    ),
  }
}

function parseBatch(value: unknown): AgentSessionFollowUpBatchView {
  const record = requireRecord(value, 'AGENT_SESSION_VIEW_BATCH_INVALID')
  const status = record.status
  if (
    status !== 'pending'
    && status !== 'ready'
    && status !== 'notified'
    && status !== 'cancelled'
  ) {
    throw new Error('AGENT_SESSION_VIEW_BATCH_STATUS_INVALID')
  }
  const progress = requireRecord(
    record.progress,
    'AGENT_SESSION_VIEW_BATCH_PROGRESS_INVALID',
  )
  return {
    batchId: requireString(
      record.batchId,
      'AGENT_SESSION_VIEW_BATCH_ID_INVALID',
    ),
    originTurnId: requireString(
      record.originTurnId,
      'AGENT_SESSION_VIEW_BATCH_ORIGIN_TURN_INVALID',
    ),
    callId: requireString(
      record.callId,
      'AGENT_SESSION_VIEW_BATCH_CALL_ID_INVALID',
    ),
    operationId: requireString(
      record.operationId,
      'AGENT_SESSION_VIEW_BATCH_OPERATION_ID_INVALID',
    ),
    status,
    notifiedTurnId: requireNullableString(
      record.notifiedTurnId,
      'AGENT_SESSION_VIEW_BATCH_NOTIFIED_TURN_INVALID',
    ),
    tasks: requireArray(
      record.tasks,
      'AGENT_SESSION_VIEW_BATCH_TASKS_INVALID',
    ).map(parseTask),
    progress: {
      total: requireInteger(
        progress.total,
        'AGENT_SESSION_VIEW_BATCH_TOTAL_INVALID',
      ),
      terminal: requireInteger(
        progress.terminal,
        'AGENT_SESSION_VIEW_BATCH_TERMINAL_INVALID',
      ),
      failed: requireInteger(
        progress.failed,
        'AGENT_SESSION_VIEW_BATCH_FAILED_INVALID',
      ),
      cancelled: requireInteger(
        progress.cancelled,
        'AGENT_SESSION_VIEW_BATCH_CANCELLED_INVALID',
      ),
    },
    createdAt: requireTimestamp(
      record.createdAt,
      'AGENT_SESSION_VIEW_BATCH_CREATED_AT_INVALID',
    ),
    readyAt: requireNullableTimestamp(
      record.readyAt,
      'AGENT_SESSION_VIEW_BATCH_READY_AT_INVALID',
    ),
    notifiedAt: requireNullableTimestamp(
      record.notifiedAt,
      'AGENT_SESSION_VIEW_BATCH_NOTIFIED_AT_INVALID',
    ),
    cancelledAt: requireNullableTimestamp(
      record.cancelledAt,
      'AGENT_SESSION_VIEW_BATCH_CANCELLED_AT_INVALID',
    ),
  }
}

function parseSubagent(value: unknown): AgentSessionSubagentView {
  const record = requireRecord(value, 'AGENT_SESSION_VIEW_SUBAGENT_INVALID')
  const status = record.status
  if (
    status !== 'running'
    && status !== 'completed'
    && status !== 'failed'
    && status !== 'cancelled'
  ) {
    throw new Error('AGENT_SESSION_VIEW_SUBAGENT_STATUS_INVALID')
  }
  requireArray(record.events, 'AGENT_SESSION_VIEW_SUBAGENT_EVENTS_INVALID')
  requireArray(
    record.skillReads,
    'AGENT_SESSION_VIEW_SUBAGENT_SKILL_READS_INVALID',
  )
  return {
    subagentId: requireString(
      record.subagentId,
      'AGENT_SESSION_VIEW_SUBAGENT_ID_INVALID',
    ),
    taskId: requireString(
      record.taskId,
      'AGENT_SESSION_VIEW_SUBAGENT_TASK_ID_INVALID',
    ),
    originTurnId: requireString(
      record.originTurnId,
      'AGENT_SESSION_VIEW_SUBAGENT_ORIGIN_TURN_INVALID',
    ),
    callId: requireString(
      record.callId,
      'AGENT_SESSION_VIEW_SUBAGENT_CALL_ID_INVALID',
    ),
    outputKind: requireString(
      record.outputKind,
      'AGENT_SESSION_VIEW_SUBAGENT_OUTPUT_KIND_INVALID',
    ) as AgentSessionSubagentView['outputKind'],
    goal: requireString(
      record.goal,
      'AGENT_SESSION_VIEW_SUBAGENT_GOAL_INVALID',
    ),
    status,
    summary: requireNullableString(
      record.summary,
      'AGENT_SESSION_VIEW_SUBAGENT_SUMMARY_INVALID',
    ),
    errorCode: requireNullableString(
      record.errorCode,
      'AGENT_SESSION_VIEW_SUBAGENT_ERROR_CODE_INVALID',
    ),
    finishedAt: requireNullableTimestamp(
      record.finishedAt,
      'AGENT_SESSION_VIEW_SUBAGENT_FINISHED_AT_INVALID',
    ),
    events: record.events as AgentSessionSubagentView['events'],
    skillReads: record.skillReads as AgentSessionSubagentView['skillReads'],
    anchorMessageId: requireNullableString(
      record.anchorMessageId,
      'AGENT_SESSION_VIEW_SUBAGENT_ANCHOR_MESSAGE_ID_INVALID',
    ),
  }
}

export async function parseAgentSessionView(
  value: unknown,
): Promise<AgentSessionView> {
  const record = requireRecord(value, 'AGENT_SESSION_VIEW_INVALID')
  if (record.protocol !== 'agent_session_view_v1') {
    throw new Error('AGENT_SESSION_VIEW_PROTOCOL_INVALID')
  }
  const rawScope = requireRecord(
    record.scope,
    'AGENT_SESSION_VIEW_SCOPE_INVALID',
  )
  const scope: AgentSessionViewScope = {
    projectId: requireString(
      rawScope.projectId,
      'AGENT_SESSION_VIEW_PROJECT_ID_INVALID',
    ),
    userId: requireString(
      rawScope.userId,
      'AGENT_SESSION_VIEW_USER_ID_INVALID',
    ),
    episodeId: requireNullableString(
      rawScope.episodeId,
      'AGENT_SESSION_VIEW_EPISODE_ID_INVALID',
    ),
    assistantId:
      rawScope.assistantId === 'workspace-command'
        ? rawScope.assistantId
        : (() => {
            throw new Error('AGENT_SESSION_VIEW_ASSISTANT_ID_INVALID')
          })(),
  }
  let thread: AgentSessionView['thread'] = null
  if (record.thread !== null) {
    const rawThread = requireRecord(
      record.thread,
      'AGENT_SESSION_VIEW_THREAD_INVALID',
    )
    const messages =
      Array.isArray(rawThread.messages) && rawThread.messages.length === 0
        ? { success: true as const, data: [] as UIMessage[] }
        : await safeValidateUIMessages({ messages: rawThread.messages })
    if (!messages.success) throw new Error('AGENT_SESSION_VIEW_MESSAGES_INVALID')
    thread = {
      threadId: requireString(
        rawThread.threadId,
        'AGENT_SESSION_VIEW_THREAD_ID_INVALID',
      ),
      messages: messages.data,
      plan:
        rawThread.plan === null
          ? null
          : requireRecord(
              rawThread.plan,
              'AGENT_SESSION_VIEW_PLAN_INVALID',
            ) as unknown as ProjectAgentPlanSnapshot,
      modelHistoryVersion: requireInteger(
        rawThread.modelHistoryVersion,
        'AGENT_SESSION_VIEW_HISTORY_VERSION_INVALID',
      ),
      createdAt: requireTimestamp(
        rawThread.createdAt,
        'AGENT_SESSION_VIEW_THREAD_CREATED_AT_INVALID',
      ),
      updatedAt: requireTimestamp(
        rawThread.updatedAt,
        'AGENT_SESSION_VIEW_THREAD_UPDATED_AT_INVALID',
      ),
    }
  }
  const currentTurn =
    record.currentTurn === null ? null : parseTurn(record.currentTurn)
  return {
    protocol: 'agent_session_view_v1',
    scope,
    thread,
    currentTurn,
    queuedTurns: requireArray(
      record.queuedTurns,
      'AGENT_SESSION_VIEW_QUEUED_TURNS_INVALID',
    ).map(parseTurn),
    recentTurns: requireArray(
      record.recentTurns,
      'AGENT_SESSION_VIEW_RECENT_TURNS_INVALID',
    ).map(parseTurn),
    pendingInteraction: parsePendingInteraction(record.pendingInteraction),
    followUpBatches: requireArray(
      record.followUpBatches,
      'AGENT_SESSION_VIEW_BATCHES_INVALID',
    ).map(parseBatch),
    subagents: requireArray(
      record.subagents,
      'AGENT_SESSION_VIEW_SUBAGENTS_INVALID',
    ).map(parseSubagent),
  }
}
