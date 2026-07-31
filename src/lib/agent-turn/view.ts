import { Prisma } from '@prisma/client'
import {
  CREATIVE_WORK_TASK_PROTOCOL,
  creativeWorkTaskPayloadSchema,
  creativeWorkTaskResultSchema,
} from '@/lib/creative-worker'
import { prisma } from '@/lib/prisma'
import {
  buildProjectAssistantScopeRef,
  validateProjectAssistantThreadMessages,
} from '@/lib/project-agent/persistence'
import {
  parseProjectAgentSubagentEventPartData,
  resolveProjectAgentSubagentViews,
} from '@/lib/project-agent/subagent-events'
import {
  parseProjectAgentPlanSnapshot,
} from '@/lib/project-agent/plan'
import { TASK_TYPE } from '@/lib/task/types'
import { TASK_STATUS, type TaskStatus } from '@/lib/task/types'
import {
  parseAgentTurnApprovalPayload,
} from './approval'
import { parseAgentTurnChoiceOfferPayload } from './choice'
import {
  AGENT_TURN_SOURCE_KIND,
  type AgentTurnSourceKind,
  type AgentTurnStatus,
} from './contracts'
import type {
  AgentSessionFollowUpBatchStatus,
  AgentSessionFollowUpBatchView,
  AgentSessionPendingInteractionView,
  AgentSessionSubagentView,
  AgentSessionTaskView,
  AgentSessionTurnView,
  AgentSessionView,
  AgentSessionViewScope,
} from './view-contract'

export type {
  AgentSessionFollowUpBatchStatus,
  AgentSessionFollowUpBatchView,
  AgentSessionPendingInteractionView,
  AgentSessionSubagentView,
  AgentSessionTaskView,
  AgentSessionTurnView,
  AgentSessionView,
  AgentSessionViewScope,
} from './view-contract'

const VIEW_RECENT_TURN_LIMIT = 24
const VIEW_RECENT_BATCH_LIMIT = 24

function parseTurnStatus(value: string): AgentTurnStatus {
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
  throw new Error(`AGENT_SESSION_VIEW_TURN_STATUS_INVALID:${value}`)
}

function parseSourceKind(value: string): AgentTurnSourceKind {
  if (
    value === AGENT_TURN_SOURCE_KIND.USER
    || value === AGENT_TURN_SOURCE_KIND.TASK_FOLLOW_UP
    || value === AGENT_TURN_SOURCE_KIND.CHOICE_RESPONSE
  ) {
    return value
  }
  throw new Error(`AGENT_SESSION_VIEW_SOURCE_KIND_INVALID:${value}`)
}

function parseTaskStatus(value: string): TaskStatus {
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
  throw new Error(`AGENT_SESSION_VIEW_TASK_STATUS_INVALID:${value}`)
}

function isTaskTerminal(status: TaskStatus): boolean {
  return status === TASK_STATUS.COMPLETED
    || status === TASK_STATUS.FAILED
    || status === TASK_STATUS.CANCELED
    || status === TASK_STATUS.DISMISSED
}

function parseBatchStatus(value: string): AgentSessionFollowUpBatchStatus {
  if (
    value === 'pending'
    || value === 'ready'
    || value === 'notified'
    || value === 'cancelled'
  ) {
    return value
  }
  throw new Error(`AGENT_SESSION_VIEW_BATCH_STATUS_INVALID:${value}`)
}

function toTurnView(turn: {
  id: string
  requestId: string
  sourceKind: string
  sourceId: string
  status: string
  attempt: number
  assistantMessageId: string | null
  stopReason: string | null
  errorCode: string | null
  errorMessage: string | null
  cancelReason: string | null
  startedAt: Date | null
  finishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}): AgentSessionTurnView {
  return {
    turnId: turn.id,
    requestId: turn.requestId,
    sourceKind: parseSourceKind(turn.sourceKind),
    sourceId: turn.sourceId,
    status: parseTurnStatus(turn.status),
    attempt: turn.attempt,
    assistantMessageId: turn.assistantMessageId,
    stopReason: turn.stopReason,
    errorCode: turn.errorCode,
    errorMessage: turn.errorMessage,
    cancelReason: turn.cancelReason,
    startedAt: turn.startedAt?.toISOString() ?? null,
    finishedAt: turn.finishedAt?.toISOString() ?? null,
    createdAt: turn.createdAt.toISOString(),
    updatedAt: turn.updatedAt.toISOString(),
  }
}

function buildPendingInteraction(
  interaction: {
    id: string
    turnId: string
    kind: string
    status: string
    payloadJson: Prisma.JsonValue
    version: number
    createdAt: Date
    turn: {
      status: string
      stopReason: string | null
    }
  } | null,
): AgentSessionPendingInteractionView | null {
  if (!interaction) return null
  if (interaction.status !== 'pending') {
    throw new Error(
      `AGENT_SESSION_VIEW_INTERACTION_NOT_PENDING:${interaction.id}`,
    )
  }
  if (interaction.kind === 'approval') {
    if (interaction.turn.status !== 'waiting_approval') {
      throw new Error(
        `AGENT_SESSION_VIEW_APPROVAL_TURN_DIVERGED:${interaction.id}:${interaction.turn.status}`,
      )
    }
    const payload = parseAgentTurnApprovalPayload(interaction.payloadJson)
    return {
      kind: 'approval',
      interactionId: interaction.id,
      turnId: interaction.turnId,
      version: interaction.version,
      members: payload.members.map((member) => ({
        approvalId: member.approvalId,
        callId: member.callId,
        operationId: member.operationId,
        operationPlan: member.operationPlan,
      })),
      createdAt: interaction.createdAt.toISOString(),
    }
  }
  if (interaction.kind === 'choice') {
    if (
      interaction.turn.status !== 'completed'
      || interaction.turn.stopReason !== 'awaiting_choice'
    ) {
      throw new Error(
        `AGENT_SESSION_VIEW_CHOICE_TURN_DIVERGED:${interaction.id}:${interaction.turn.status}`,
      )
    }
    const offer = parseAgentTurnChoiceOfferPayload(interaction.payloadJson)
    if (offer.offerId !== interaction.id) {
      throw new Error(
        `AGENT_SESSION_VIEW_CHOICE_ID_DIVERGED:${interaction.id}:${offer.offerId}`,
      )
    }
    return {
      kind: 'choice',
      interactionId: interaction.id,
      turnId: interaction.turnId,
      version: interaction.version,
      operationId: offer.operationId,
      callId: offer.callId,
      card: offer.card,
      createdAt: interaction.createdAt.toISOString(),
    }
  }
  throw new Error(
    `AGENT_SESSION_VIEW_INTERACTION_KIND_INVALID:${interaction.id}:${interaction.kind}`,
  )
}

export async function getAgentSessionView(
  input: AgentSessionViewScope,
): Promise<AgentSessionView> {
  const scopeRef = buildProjectAssistantScopeRef({
    projectId: input.projectId,
    episodeId: input.episodeId,
  })
  return await prisma.$transaction(
    async (tx): Promise<AgentSessionView> => {
      const thread = await tx.projectAssistantThread.findUnique({
        where: {
          projectId_userId_assistantId_scopeRef: {
            projectId: input.projectId,
            userId: input.userId,
            assistantId: input.assistantId,
            scopeRef,
          },
        },
      })
      if (!thread) {
        return {
          protocol: 'agent_session_view_v1',
          scope: input,
          thread: null,
          currentTurn: null,
          queuedTurns: [],
          recentTurns: [],
          pendingInteraction: null,
          followUpBatches: [],
          subagents: [],
        }
      }
      if (
        thread.projectId !== input.projectId
        || thread.userId !== input.userId
        || thread.episodeId !== input.episodeId
        || thread.assistantId !== input.assistantId
      ) {
        throw new Error(
          `AGENT_SESSION_VIEW_THREAD_SCOPE_DIVERGED:${thread.id}`,
        )
      }
      const [
        openTurnRows,
        recentTurnRows,
        interactions,
        batches,
        creativeTasks,
        messages,
      ] = await Promise.all([
        tx.projectAgentTurn.findMany({
          where: {
            threadId: thread.id,
            status: { in: ['queued', 'running', 'waiting_approval'] },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 66,
        }),
        tx.projectAgentTurn.findMany({
          where: { threadId: thread.id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: VIEW_RECENT_TURN_LIMIT,
        }),
        tx.agentTurnInteraction.findMany({
          where: {
            status: 'pending',
            turn: { threadId: thread.id },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: {
            turn: {
              select: { status: true, stopReason: true },
            },
          },
        }),
        tx.followUpBatch.findMany({
          where: { threadId: thread.id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: VIEW_RECENT_BATCH_LIMIT,
          include: {
            members: {
              orderBy: { taskId: 'asc' },
              include: {
                task: {
                  select: {
                    id: true,
                    operationId: true,
                    type: true,
                    targetType: true,
                    targetId: true,
                    status: true,
                    errorCode: true,
                    errorMessage: true,
                    createdAt: true,
                    finishedAt: true,
                  },
                },
              },
            },
          },
        }),
        tx.task.findMany({
          where: {
            projectId: input.projectId,
            userId: input.userId,
            type: TASK_TYPE.CREATIVE_WORK,
            payload: {
              path: '$.protocol',
              equals: CREATIVE_WORK_TASK_PROTOCOL,
            },
            followUpMemberships: {
              some: {
                batch: { threadId: thread.id },
              },
            },
            status: {
              in: [
                TASK_STATUS.QUEUED,
                TASK_STATUS.PROCESSING,
                TASK_STATUS.COMPLETED,
                TASK_STATUS.FAILED,
                TASK_STATUS.CANCELED,
              ],
            },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 24,
          select: {
            id: true,
            status: true,
            payload: true,
            result: true,
            errorCode: true,
            finishedAt: true,
          },
        }),
        validateProjectAssistantThreadMessages(thread.messagesJson),
      ])
      if (openTurnRows.length > 65) {
        throw new Error(
          `AGENT_SESSION_VIEW_OPEN_TURN_LIMIT_EXCEEDED:${thread.id}`,
        )
      }
      if (interactions.length > 1) {
        throw new Error(
          `AGENT_SESSION_VIEW_PENDING_INTERACTION_CONFLICT:${thread.id}:${interactions.map((item) => item.id).join(',')}`,
        )
      }
      const openTurnViews = openTurnRows.map(toTurnView)
      const recentTurnViews = recentTurnRows.map(toTurnView)
      const executingTurns = openTurnViews.filter(
        (turn) => (
          turn.status === 'running'
          || turn.status === 'waiting_approval'
        ),
      )
      if (executingTurns.length > 1) {
        throw new Error(
          `AGENT_SESSION_VIEW_ACTIVE_TURN_CONFLICT:${thread.id}:${executingTurns.map((turn) => turn.turnId).join(',')}`,
        )
      }
      const queuedTurns = openTurnViews.filter(
        (turn) => turn.status === 'queued',
      )
      const currentTurn =
        executingTurns[0]
        ?? queuedTurns[0]
        ?? recentTurnViews[0]
        ?? null
      const pendingQueuedTurns =
        currentTurn?.status === 'queued'
          ? queuedTurns.slice(1)
          : queuedTurns
      const followUpBatches = batches.map(
        (batch): AgentSessionFollowUpBatchView => {
          const tasks = batch.members.map(
            ({ task }): AgentSessionTaskView => {
              const status = parseTaskStatus(task.status)
              return {
                taskId: task.id,
                operationId: task.operationId,
                taskType: task.type,
                targetType: task.targetType,
                targetId: task.targetId,
                status,
                terminal: isTaskTerminal(status),
                errorCode: task.errorCode,
                errorMessage: task.errorMessage,
                createdAt: task.createdAt.toISOString(),
                finishedAt: task.finishedAt?.toISOString() ?? null,
              }
            },
          )
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
              failed: tasks.filter(
                (task) => (
                  task.status === TASK_STATUS.FAILED
                  || task.status === TASK_STATUS.DISMISSED
                ),
              ).length,
              cancelled: tasks.filter(
                (task) => task.status === TASK_STATUS.CANCELED,
              ).length,
            },
            createdAt: batch.createdAt.toISOString(),
            readyAt: batch.readyAt?.toISOString() ?? null,
            notifiedAt: batch.notifiedAt?.toISOString() ?? null,
            cancelledAt: batch.cancelledAt?.toISOString() ?? null,
          }
        },
      )
      const parsedCreativeTasks = creativeTasks.map((task) => {
        const payload = creativeWorkTaskPayloadSchema.parse(task.payload)
        const result = creativeWorkTaskResultSchema.safeParse(task.result)
        if (task.status === TASK_STATUS.COMPLETED && !result.success) {
          throw new Error(
            `AGENT_SESSION_VIEW_SUBAGENT_RESULT_INVALID:${task.id}`,
          )
        }
        return { task, payload, result }
      })
      const subagentEvents = parsedCreativeTasks.flatMap(
        ({ task, payload, result }) => {
          const lifecycle = result.success
            ? result.data.lifecycleProjection
            : payload.lifecycleProjection
          return lifecycle.events.map((progressEvent) => (
            parseProjectAgentSubagentEventPartData({
              subagentId: task.id,
              taskId: task.id,
              originTurnId: payload.origin.turnId,
              callId: payload.origin.callId,
              sequence: progressEvent.sequence,
              occurredAt: progressEvent.occurredAt,
              event: progressEvent.event,
            })
          ))
        },
      )
      const resolvedSubagents = resolveProjectAgentSubagentViews(
        subagentEvents,
        parsedCreativeTasks.map(({ task, result }) => {
          const status = parseTaskStatus(task.status)
          if (
            status !== TASK_STATUS.QUEUED
            && status !== TASK_STATUS.PROCESSING
            && status !== TASK_STATUS.COMPLETED
            && status !== TASK_STATUS.FAILED
            && status !== TASK_STATUS.CANCELED
          ) {
            throw new Error(
              `AGENT_SESSION_VIEW_SUBAGENT_STATUS_INVALID:${task.id}:${status}`,
            )
          }
          return {
            taskId: task.id,
            status,
            summary: result.success ? result.data.summary : null,
            errorCode: task.errorCode,
            finishedAt: task.finishedAt?.toISOString() ?? null,
          }
        }),
      )
      const originTurnIds = Array.from(new Set(
        resolvedSubagents.map((subagent) => subagent.originTurnId),
      ))
      const originTurns = originTurnIds.length > 0
        ? await tx.projectAgentTurn.findMany({
            where: { id: { in: originTurnIds } },
            select: {
              id: true,
              threadId: true,
              assistantMessageId: true,
            },
          })
        : []
      const originTurnById = new Map(
        originTurns.map((turn) => [turn.id, turn] as const),
      )
      const subagents = resolvedSubagents.map(
        (subagent): AgentSessionSubagentView => {
          const originTurn = originTurnById.get(subagent.originTurnId)
          if (!originTurn || originTurn.threadId !== thread.id) {
            throw new Error(
              `AGENT_SESSION_VIEW_SUBAGENT_ORIGIN_DIVERGED:${subagent.taskId}:${subagent.originTurnId}`,
            )
          }
          return {
            ...subagent,
            anchorMessageId: originTurn.assistantMessageId,
          }
        },
      )
      return {
        protocol: 'agent_session_view_v1',
        scope: input,
        thread: {
          threadId: thread.id,
          messages,
          plan: parseProjectAgentPlanSnapshot(thread.planJson),
          modelHistoryVersion: thread.modelHistoryVersion,
          createdAt: thread.createdAt.toISOString(),
          updatedAt: thread.updatedAt.toISOString(),
        },
        currentTurn,
        queuedTurns: pendingQueuedTurns,
        recentTurns: recentTurnViews,
        pendingInteraction: buildPendingInteraction(
          interactions[0] ?? null,
        ),
        followUpBatches,
        subagents,
      }
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 10_000,
      timeout: 30_000,
    },
  )
}
