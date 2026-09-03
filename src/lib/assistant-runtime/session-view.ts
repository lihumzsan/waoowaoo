import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildAgentTurnAssistantMessageId } from '@/lib/agent-turn/stream-publisher'
import { hasProviderFailureEvidence, parseFailureRecord } from '@/lib/errors/failure'
import type { RuntimeJsonValue } from '@/lib/codex-runtime/runtime-adapter'
import {
  parseProjectAgentPlanSnapshot,
} from '@/lib/project-agent/plan'
import type {
  AssistantRuntimePendingInteractionView,
  AssistantRuntimeSessionTurnView,
  AssistantRuntimeSessionView,
  AssistantRuntimeSessionViewScope,
} from './view-contract'
import { readLatestAssistantRuntimeMessagePage } from './message-store'

const RECENT_TURN_LIMIT = 24
const RECENT_BATCH_LIMIT = 24
const ACTIVE_STATUSES = ['queued', 'running', 'waiting_approval'] as const
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'canceled', 'dismissed'])

// Keep every JSON column out of the ordered phase. MySQL otherwise copies the
// selected JSON values into its filesort rows and can exhaust sort memory.
const TURN_VIEW_ORDER_SELECT = {
  id: true,
  requestId: true,
  sourceKind: true,
  sourceId: true,
  status: true,
  attempt: true,
  assistantMessageId: true,
  stopReason: true,
  cancelReason: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.ProjectAgentTurnSelect

const TURN_VIEW_DETAILS_SELECT = {
  id: true,
  planJson: true,
  failure: true,
} as const satisfies Prisma.ProjectAgentTurnSelect

type TurnViewOrderRow = Prisma.ProjectAgentTurnGetPayload<{
  select: typeof TURN_VIEW_ORDER_SELECT
}>

type TurnViewDetailsRow = Prisma.ProjectAgentTurnGetPayload<{
  select: typeof TURN_VIEW_DETAILS_SELECT
}>

type TurnViewRow = TurnViewOrderRow & Omit<TurnViewDetailsRow, 'id'>

const INTERACTION_VIEW_ORDER_SELECT = {
  id: true,
  turnId: true,
  version: true,
  status: true,
  runtimeRequestId: true,
  createdAt: true,
} as const satisfies Prisma.AgentTurnInteractionSelect

const INTERACTION_VIEW_DETAILS_SELECT = {
  id: true,
  payloadJson: true,
  responseJson: true,
} as const satisfies Prisma.AgentTurnInteractionSelect

type InteractionViewOrderRow = Prisma.AgentTurnInteractionGetPayload<{
  select: typeof INTERACTION_VIEW_ORDER_SELECT
}>

type InteractionViewDetailsRow = Prisma.AgentTurnInteractionGetPayload<{
  select: typeof INTERACTION_VIEW_DETAILS_SELECT
}>

type InteractionViewRow = InteractionViewOrderRow & Omit<InteractionViewDetailsRow, 'id'>

const FOLLOW_UP_BATCH_VIEW_SELECT = {
  id: true,
  originTurnId: true,
  callId: true,
  operationId: true,
  status: true,
  notifiedTurnId: true,
  createdAt: true,
  readyAt: true,
  notifiedAt: true,
  cancelledAt: true,
  members: {
    orderBy: { taskId: 'asc' as const },
    select: {
      task: {
        select: {
          id: true,
          operationId: true,
          type: true,
          targetType: true,
          targetId: true,
          status: true,
          createdAt: true,
          finishedAt: true,
        },
      },
    },
  },
} as const satisfies Prisma.FollowUpBatchSelect

const TASK_FAILURE_SELECT = {
  id: true,
  failure: true,
} as const satisfies Prisma.TaskSelect

function hydrateTurnRows(
  rows: readonly TurnViewOrderRow[],
  detailsById: ReadonlyMap<string, TurnViewDetailsRow>,
): TurnViewRow[] {
  return rows.map((row) => {
    const details = detailsById.get(row.id)
    if (!details) throw new Error(`ASSISTANT_RUNTIME_VIEW_TURN_DETAILS_MISSING:${row.id}`)
    return { ...row, planJson: details.planJson, failure: details.failure }
  })
}

function hydrateInteractionRows(
  rows: readonly InteractionViewOrderRow[],
  detailsById: ReadonlyMap<string, InteractionViewDetailsRow>,
): InteractionViewRow[] {
  return rows.map((row) => {
    const details = detailsById.get(row.id)
    if (!details) throw new Error(`ASSISTANT_RUNTIME_VIEW_INTERACTION_DETAILS_MISSING:${row.id}`)
    return { ...row, payloadJson: details.payloadJson, responseJson: details.responseJson }
  })
}

function parseTurnStatus(value: string): AssistantRuntimeSessionTurnView['status'] {
  if (
    value === 'queued' || value === 'running' || value === 'waiting_approval'
    || value === 'completed' || value === 'failed' || value === 'interrupted'
    || value === 'cancelled'
  ) return value
  throw new Error(`ASSISTANT_RUNTIME_VIEW_TURN_STATUS_INVALID:${value}`)
}

function parseSourceKind(value: string): AssistantRuntimeSessionTurnView['sourceKind'] {
  if (value === 'user' || value === 'task_follow_up') return value
  throw new Error(`ASSISTANT_RUNTIME_VIEW_SOURCE_KIND_INVALID:${value}`)
}

function toTurnView(row: TurnViewRow): AssistantRuntimeSessionTurnView {
  const status = parseTurnStatus(row.status)
  const failure = parseFailureRecord(row.failure)
  return {
    turnId: row.id,
    requestId: row.requestId,
    sourceKind: parseSourceKind(row.sourceKind),
    sourceId: row.sourceId,
    status,
    attempt: row.attempt,
    plan: status === 'running' || status === 'waiting_approval'
      ? parseProjectAgentPlanSnapshot(row.planJson)
      : null,
    assistantMessageId: row.assistantMessageId ?? (
      row.startedAt && (status === 'running' || status === 'waiting_approval')
      ? buildAgentTurnAssistantMessageId({ turnId: row.id, attempt: row.attempt })
      : null
    ),
    stopReason: row.stopReason,
    errorCode: failure?.interpretation.code ?? null,
    errorDiagnostic: failure && hasProviderFailureEvidence(failure)
      ? failure.native.message
      : null,
    cancelReason: row.cancelReason,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function parseInteraction(row: {
  readonly id: string
  readonly turnId: string
  readonly version: number
  readonly status: string
  readonly runtimeRequestId: string | null
  readonly payloadJson: Prisma.JsonValue
  readonly responseJson: Prisma.JsonValue | null
  readonly createdAt: Date
}): AssistantRuntimePendingInteractionView {
  if (
    !row.runtimeRequestId
    || (row.status !== 'pending' && row.status !== 'delivery_pending' && row.status !== 'decided')
  ) {
    throw new Error(`ASSISTANT_RUNTIME_VIEW_INTERACTION_INVALID:${row.id}`)
  }
  if (!row.payloadJson || typeof row.payloadJson !== 'object' || Array.isArray(row.payloadJson)) {
    throw new Error(`ASSISTANT_RUNTIME_VIEW_INTERACTION_PAYLOAD_INVALID:${row.id}`)
  }
  const payload = row.payloadJson as Record<string, Prisma.JsonValue>
  if (
    typeof payload.method !== 'string'
    || !payload.method.trim()
    || payload.params === undefined
    || (typeof payload.requestId !== 'string' && typeof payload.requestId !== 'number')
  ) {
    throw new Error(`ASSISTANT_RUNTIME_VIEW_INTERACTION_PAYLOAD_INVALID:${row.id}`)
  }
  return {
    kind: 'runtime_request',
    interactionId: row.id,
    turnId: row.turnId,
    version: row.version,
    runtimeRequestId: row.runtimeRequestId,
    requestId: payload.requestId,
    method: payload.method,
    params: payload.params as RuntimeJsonValue,
    response: row.responseJson as RuntimeJsonValue | null,
    status: row.status === 'pending' ? 'pending' : 'decided',
    createdAt: row.createdAt.toISOString(),
  }
}

function parseBatchStatus(value: string): 'pending' | 'ready' | 'notified' | 'cancelled' {
  if (value === 'pending' || value === 'ready' || value === 'notified' || value === 'cancelled') return value
  throw new Error(`ASSISTANT_RUNTIME_VIEW_BATCH_STATUS_INVALID:${value}`)
}

export async function getAssistantRuntimeSessionView(
  input: AssistantRuntimeSessionViewScope,
): Promise<AssistantRuntimeSessionView> {
  return await prisma.$transaction(async (tx): Promise<AssistantRuntimeSessionView> => {
    const thread = await tx.projectAssistantThread.findUnique({
      where: {
        projectId_userId_assistantId: {
          projectId: input.projectId,
          userId: input.userId,
          assistantId: input.assistantId,
        },
      },
    })
    if (!thread) {
      return {
        protocol: 'assistant_runtime_session_view_v2',
        scope: input,
        thread: null,
        currentTurn: null,
        queuedTurns: [],
        recentTurns: [],
        pendingInteraction: null,
        followUpBatches: [],
      }
    }
    if (
      thread.projectId !== input.projectId
      || thread.userId !== input.userId
      || thread.assistantId !== input.assistantId
    ) throw new Error('ASSISTANT_RUNTIME_VIEW_THREAD_SCOPE_DIVERGED')

    const [
      openOrderRows,
      recentOrderRows,
      interactionOrderRows,
      batches,
      currentResourceTaskRows,
      messagePage,
    ] = await Promise.all([
      tx.projectAgentTurn.findMany({
        where: { threadId: thread.id, status: { in: [...ACTIVE_STATUSES] } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 66,
        select: TURN_VIEW_ORDER_SELECT,
      }),
      tx.projectAgentTurn.findMany({
        where: { threadId: thread.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: RECENT_TURN_LIMIT,
        select: TURN_VIEW_ORDER_SELECT,
      }),
      tx.agentTurnInteraction.findMany({
        where: {
          turn: { threadId: thread.id },
          status: { in: ['pending', 'delivery_pending', 'decided'] },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: INTERACTION_VIEW_ORDER_SELECT,
      }),
      tx.followUpBatch.findMany({
        where: { threadId: thread.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: RECENT_BATCH_LIMIT,
        select: FOLLOW_UP_BATCH_VIEW_SELECT,
      }),
      tx.workspaceResource.findMany({
        where: {
          projectId: input.projectId,
          deletedAt: null,
          taskId: { not: null },
        },
        select: { id: true, taskId: true },
      }),
      readLatestAssistantRuntimeMessagePage(tx, thread.id),
    ])
    if (openOrderRows.length > 65) throw new Error('ASSISTANT_RUNTIME_VIEW_OPEN_TURN_LIMIT_EXCEEDED')
    if (interactionOrderRows.length > 1) throw new Error('ASSISTANT_RUNTIME_VIEW_INTERACTION_CONFLICT')
    const turnIds = [...new Set([...openOrderRows, ...recentOrderRows].map((row) => row.id))]
    const interactionIds = interactionOrderRows.map((row) => row.id)
    const failedTaskIds = batches.flatMap((batch) => batch.members.flatMap(({ task }) => (
      task.status === 'failed' ? [task.id] : []
    )))
    const [turnDetails, interactionDetails, taskFailures] = await Promise.all([
      turnIds.length === 0
        ? Promise.resolve([])
        : tx.projectAgentTurn.findMany({
            where: { id: { in: turnIds } },
            select: TURN_VIEW_DETAILS_SELECT,
          }),
      interactionIds.length === 0
        ? Promise.resolve([])
        : tx.agentTurnInteraction.findMany({
            where: { id: { in: interactionIds } },
            select: INTERACTION_VIEW_DETAILS_SELECT,
          }),
      failedTaskIds.length === 0
        ? Promise.resolve([])
        : tx.task.findMany({
            where: { id: { in: failedTaskIds } },
            select: TASK_FAILURE_SELECT,
          }),
    ])
    const turnDetailsById = new Map(turnDetails.map((row) => [row.id, row] as const))
    const interactionDetailsById = new Map(interactionDetails.map((row) => [row.id, row] as const))
    const taskFailureById = new Map(taskFailures.map((row) => [row.id, row.failure] as const))
    const openRows = hydrateTurnRows(openOrderRows, turnDetailsById)
    const recentRows = hydrateTurnRows(recentOrderRows, turnDetailsById)
    const interactions = hydrateInteractionRows(interactionOrderRows, interactionDetailsById)
    const open = openRows.map(toTurnView)
    const recent = recentRows.map(toTurnView)
    const executing = open.filter((turn) => turn.status === 'running' || turn.status === 'waiting_approval')
    if (executing.length > 1) throw new Error('ASSISTANT_RUNTIME_VIEW_ACTIVE_TURN_CONFLICT')
    const queued = open.filter((turn) => turn.status === 'queued')
    const current = executing[0] ?? queued[0] ?? recent[0] ?? null

    const currentTaskByResourceId = new Map(
      currentResourceTaskRows.flatMap((row) => row.taskId ? [[row.id, row.taskId] as const] : []),
    )
    const followUpBatches = batches.flatMap((batch) => {
      // Follow-up batches are the live operational overlay, not a second Task
      // history. A retried WorkspaceResource keeps the same Resource identity
      // and rebinds taskId to the replacement attempt. Only positive evidence
      // of that replacement suppresses an older member; missing/deleted targets
      // stay visible so a real invariant failure can never disappear silently.
      const tasks = batch.members.flatMap(({ task }) => {
        const currentTaskId = task.targetType === 'WorkspaceResource'
          ? currentTaskByResourceId.get(task.targetId)
          : undefined
        if (currentTaskId && currentTaskId !== task.id) return []
        if (task.status === 'failed' && !taskFailureById.has(task.id)) {
          throw new Error(`ASSISTANT_RUNTIME_VIEW_TASK_FAILURE_MISSING:${task.id}`)
        }
        return [{
        taskId: task.id,
        operationId: task.operationId,
        taskType: task.type,
        targetType: task.targetType,
        targetId: task.targetId,
        status: task.status,
        terminal: TERMINAL_TASK_STATUSES.has(task.status),
        errorCode: task.status === 'failed'
          ? parseFailureRecord(taskFailureById.get(task.id))?.interpretation.code ?? 'INTERNAL_ERROR'
          : null,
        createdAt: task.createdAt.toISOString(),
        finishedAt: task.finishedAt?.toISOString() ?? null,
        }]
      })
      if (tasks.length === 0) return []
      return [{
        batchId: batch.id,
        originTurnId: batch.originTurnId,
        callId: batch.callId,
        operationId: batch.operationId,
        status: parseBatchStatus(batch.status),
        notifiedTurnId: batch.notifiedTurnId,
        tasks,
        progress: {
          total: tasks.length,
          terminal: tasks.filter((task) => task.terminal).length,
          failed: tasks.filter((task) => task.status === 'failed' || task.status === 'dismissed').length,
          cancelled: tasks.filter((task) => task.status === 'canceled').length,
        },
        createdAt: batch.createdAt.toISOString(),
        readyAt: batch.readyAt?.toISOString() ?? null,
        notifiedAt: batch.notifiedAt?.toISOString() ?? null,
        cancelledAt: batch.cancelledAt?.toISOString() ?? null,
      }]
    })
    return {
      protocol: 'assistant_runtime_session_view_v2',
      scope: input,
      thread: {
        threadId: thread.id,
        messages: messagePage.messages,
        messagePage: messagePage.messagePage,
        createdAt: thread.createdAt.toISOString(),
        updatedAt: thread.updatedAt.toISOString(),
      },
      currentTurn: current,
      queuedTurns: current?.status === 'queued' ? queued.slice(1) : queued,
      recentTurns: recent,
      pendingInteraction: interactions[0] ? parseInteraction(interactions[0]) : null,
      followUpBatches,
    }
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    maxWait: 10_000,
    timeout: 30_000,
  })
}
