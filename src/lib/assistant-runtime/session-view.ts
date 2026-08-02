import { Prisma } from '@prisma/client'
import { safeValidateUIMessages, type UIMessage } from 'ai'
import { prisma } from '@/lib/prisma'
import { resolveUnifiedErrorCode } from '@/lib/errors/codes'
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

const RECENT_TURN_LIMIT = 24
const RECENT_BATCH_LIMIT = 24
const ACTIVE_STATUSES = ['queued', 'running', 'waiting_approval'] as const
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'canceled', 'dismissed'])

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

function toTurnView(row: {
  readonly id: string
  readonly requestId: string
  readonly sourceKind: string
  readonly sourceId: string
  readonly status: string
  readonly attempt: number
  readonly assistantMessageId: string | null
  readonly stopReason: string | null
  readonly errorCode: string | null
  readonly cancelReason: string | null
  readonly startedAt: Date | null
  readonly finishedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}): AssistantRuntimeSessionTurnView {
  return {
    turnId: row.id,
    requestId: row.requestId,
    sourceKind: parseSourceKind(row.sourceKind),
    sourceId: row.sourceId,
    status: parseTurnStatus(row.status),
    attempt: row.attempt,
    assistantMessageId: row.assistantMessageId,
    stopReason: row.stopReason,
    errorCode: row.errorCode ? resolveUnifiedErrorCode(row.errorCode) ?? 'INTERNAL_ERROR' : null,
    cancelReason: row.cancelReason,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function parseMessages(value: unknown): Promise<readonly UIMessage[]> {
  if (Array.isArray(value) && value.length === 0) return []
  const parsed = await safeValidateUIMessages({ messages: value })
  if (!parsed.success) throw new Error('ASSISTANT_RUNTIME_VIEW_MESSAGES_INVALID')
  return parsed.data
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
  if (!row.runtimeRequestId || (row.status !== 'pending' && row.status !== 'decided')) {
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
    status: row.status,
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
        protocol: 'assistant_runtime_session_view_v1',
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

    const [openRows, recentRows, interactions, batches, messages] = await Promise.all([
      tx.projectAgentTurn.findMany({
        where: { threadId: thread.id, status: { in: [...ACTIVE_STATUSES] } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 66,
      }),
      tx.projectAgentTurn.findMany({
        where: { threadId: thread.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: RECENT_TURN_LIMIT,
      }),
      tx.agentTurnInteraction.findMany({
        where: { turn: { threadId: thread.id }, status: { in: ['pending', 'decided'] } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      tx.followUpBatch.findMany({
        where: { threadId: thread.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: RECENT_BATCH_LIMIT,
        include: {
          members: {
            orderBy: { taskId: 'asc' },
            include: { task: true },
          },
        },
      }),
      parseMessages(thread.messagesJson),
    ])
    if (openRows.length > 65) throw new Error('ASSISTANT_RUNTIME_VIEW_OPEN_TURN_LIMIT_EXCEEDED')
    if (interactions.length > 1) throw new Error('ASSISTANT_RUNTIME_VIEW_INTERACTION_CONFLICT')
    const open = openRows.map(toTurnView)
    const recent = recentRows.map(toTurnView)
    const executing = open.filter((turn) => turn.status === 'running' || turn.status === 'waiting_approval')
    if (executing.length > 1) throw new Error('ASSISTANT_RUNTIME_VIEW_ACTIVE_TURN_CONFLICT')
    const queued = open.filter((turn) => turn.status === 'queued')
    const current = executing[0] ?? queued[0] ?? recent[0] ?? null

    const followUpBatches = batches.map((batch) => {
      const tasks = batch.members.map(({ task }) => ({
        taskId: task.id,
        operationId: task.operationId,
        taskType: task.type,
        targetType: task.targetType,
        targetId: task.targetId,
        status: task.status,
        terminal: TERMINAL_TASK_STATUSES.has(task.status),
        errorCode: task.status === 'failed'
          ? resolveUnifiedErrorCode(task.errorCode) ?? 'INTERNAL_ERROR'
          : null,
        createdAt: task.createdAt.toISOString(),
        finishedAt: task.finishedAt?.toISOString() ?? null,
      }))
      return {
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
      }
    })
    return {
      protocol: 'assistant_runtime_session_view_v1',
      scope: input,
      thread: {
        threadId: thread.id,
        messages,
        plan: parseProjectAgentPlanSnapshot(thread.planJson),
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
