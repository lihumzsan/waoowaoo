import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createScopedLogger } from '@/lib/logging/core'
import type { ProjectAssistantId } from './types'
import { buildProjectAssistantScopeRef } from './persistence'
import { appendProjectAgentEvents, appendProjectAgentEventsInTransaction } from './event'
import type { ProjectAgentChoiceCardDefinition } from './types'
import {
  assertProjectAgentChoiceOfferCurrent,
  buildProjectAgentChoiceOffer,
  parseProjectAgentChoiceDecision,
  parseProjectAgentChoiceOffer,
  type ProjectAgentChoiceOffer,
  type ProjectAgentChoiceReviewedResource,
} from './choice-offer'
import type { EditFirstChoiceDecision } from './edit-first-choice-result'
import {
  createProjectAgentRunFence,
  type ProjectAgentRunFence,
} from './run-fence'

export type ProjectAgentInterruptionType = 'approval' | 'choice' | 'task_wait'
export type ProjectAgentInterruptionStatus = 'pending' | 'consumed' | 'superseded'

export interface ProjectAgentInterruptionScope {
  projectId: string
  userId: string
  episodeId?: string | null
  assistantId?: ProjectAssistantId
}

export interface ProjectAgentApprovalInterruptionRecord {
  id: string
  runId: string | null
  activityId: string | null
  type: ProjectAgentInterruptionType
  status: ProjectAgentInterruptionStatus
  operationId: string
  approvalId: string
  toolCallId: string | null
  payload?: Prisma.JsonValue
  runState: string
}

export interface ProjectAgentChoiceInterruptionRecord {
  id: string
  runId: string | null
  activityId: string | null
  type: 'choice'
  status: ProjectAgentInterruptionStatus
  operationId: string
  toolCallId: string | null
  payload: Prisma.JsonValue
  offer: ProjectAgentChoiceOffer
}

export interface ProjectAgentInterruptionSnapshot {
  id: string
  runId: string | null
  activityId: string | null
  type: ProjectAgentInterruptionType
  status: ProjectAgentInterruptionStatus
  operationId: string
  approvalId: string
  toolCallId: string | null
  payload: Prisma.JsonValue
}

function isInterruptionConsumeRace(error: unknown): boolean {
  return error instanceof Error
    && error.message.startsWith('PROJECT_AGENT_INTERRUPTION_TRANSITION_RACED')
}

const projectAgentInterruptionLogger = createScopedLogger({
  module: 'project-agent.interruptions',
})

function buildScope(scope: ProjectAgentInterruptionScope): {
  assistantId: ProjectAssistantId
  scopeRef: string
} {
  const assistantId = scope.assistantId ?? 'workspace-command'
  return {
    assistantId,
    scopeRef: buildProjectAssistantScopeRef({
      projectId: scope.projectId,
      episodeId: scope.episodeId ?? null,
    }),
  }
}

function normalizeInterruptionType(value: string): ProjectAgentInterruptionType {
  if (value === 'approval' || value === 'choice' || value === 'task_wait') return value
  throw new Error(`PROJECT_AGENT_INTERRUPTION_TYPE_INVALID:${value}`)
}

function normalizeInterruptionStatus(value: string): ProjectAgentInterruptionStatus {
  if (value === 'pending' || value === 'consumed' || value === 'superseded') return value
  throw new Error(`PROJECT_AGENT_INTERRUPTION_STATUS_INVALID:${value}`)
}

function toInterruptionSnapshot(record: {
  id: string
  runId: string | null
  activityId: string | null
  type: string
  status: string
  operationId: string
  approvalId: string
  toolCallId: string | null
  payload: Prisma.JsonValue
}): ProjectAgentInterruptionSnapshot {
  return {
    id: record.id,
    runId: record.runId,
    activityId: record.activityId,
    type: normalizeInterruptionType(record.type),
    status: normalizeInterruptionStatus(record.status),
    operationId: record.operationId,
    approvalId: record.approvalId,
    toolCallId: record.toolCallId,
    payload: record.payload,
  }
}

/**
 * Registers a pending approval interruption. Any previously pending interruption
 * in the same scope is superseded: a scope has at most one pending interruption.
 * The serialized RunState stays server-side; clients only ever see the id.
 */
export async function createProjectAgentApprovalInterruption(params: ProjectAgentInterruptionScope & {
  runFence: ProjectAgentRunFence
  runId: string
  operationId: string
  approvalId: string
  toolCallId: string | null
  runState: string
  payload?: Prisma.InputJsonValue
  previousActivityId?: string | null
}): Promise<string> {
  const activityId = randomUUID()
  const interruptionId = randomUUID()
  const superseded = await supersedePendingProjectAgentInterruptions(params)
  if (superseded.length > 0) {
    projectAgentInterruptionLogger.warn({
      action: 'assistant.interruption.superseded-by-new',
      message: 'Pending project agent interruptions superseded by a new interruption',
      projectId: params.projectId,
      userId: params.userId,
      details: { supersededIds: superseded.map((record) => record.id) },
    })
  }
  await appendProjectAgentEvents({
    scope: params,
    events: [
      ...(params.previousActivityId
        ? [{
            runFence: params.runFence,
            idempotencyKey: `activity-completed:${params.previousActivityId}:before:${activityId}`,
            event: {
              kind: 'activity.completed' as const,
              runId: params.runId,
              activityId: params.previousActivityId,
            },
          }]
        : []),
      {
        runFence: params.runFence,
        idempotencyKey: `interruption-raised:${interruptionId}`,
        event: {
          kind: 'interruption.raised',
          runId: params.runId,
          activityId,
          interruptionId,
          interruptionKind: 'approval',
          operationId: params.operationId,
          approvalId: params.approvalId,
          toolCallId: params.toolCallId,
          payload: params.payload ?? {},
          runState: params.runState,
        },
      },
    ],
  })
  return interruptionId
}

export async function createProjectAgentChoiceInterruption(params: ProjectAgentInterruptionScope & {
  runFence: ProjectAgentRunFence
  runId: string
  operationId: string
  toolCallId: string
  card: ProjectAgentChoiceCardDefinition
  reviewedResource: ProjectAgentChoiceReviewedResource
  previousActivityId?: string | null
}): Promise<ProjectAgentChoiceOffer> {
  const activityId = randomUUID()
  const interruptionId = randomUUID()
  const offer = buildProjectAgentChoiceOffer({
    runId: params.runId,
    interruptionId,
    card: params.card,
    reviewedResource: params.reviewedResource,
  })
  const { assistantId, scopeRef } = buildScope(params)
  let supersededIds: string[] = []
  await prisma.$transaction(async (tx) => {
    const lockedRun = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM project_agent_runs
      WHERE id = ${params.runId}
      FOR UPDATE
    `)
    if (lockedRun.length !== 1) {
      throw new Error(`PROJECT_AGENT_CHOICE_RUN_LOCK_FAILED:${params.runId}`)
    }
    await assertProjectAgentChoiceOfferCurrent({
      tx,
      projectId: params.projectId,
      userId: params.userId,
      episodeId: params.episodeId,
      offer,
    })
    const pending = await tx.projectAgentInterruption.findMany({
      where: {
        projectId: params.projectId,
        userId: params.userId,
        assistantId,
        scopeRef,
        status: 'pending',
      },
      select: {
        id: true,
        runId: true,
        activityId: true,
        runVersion: true,
        eventSeq: true,
      },
    })
    if (pending.some((record) => !record.runId)) {
      throw new Error('PROJECT_AGENT_PENDING_INTERRUPTION_RUN_ID_MISSING')
    }
    supersededIds = pending.map((record) => record.id)
    await appendProjectAgentEventsInTransaction(tx, {
      scope: {
        projectId: params.projectId,
        userId: params.userId,
        episodeId: params.episodeId ?? null,
        assistantId,
        scopeRef,
      },
      events: [
      ...pending.map((record) => ({
        runFence: record.runId === params.runId
          ? params.runFence
          : createProjectAgentRunFence({
              id: record.runId as string,
              runVersion: record.runVersion,
              eventSeq: record.eventSeq,
            }),
        idempotencyKey: `interruption-resolved:${record.id}:superseded`,
        event: {
          kind: 'interruption.resolved' as const,
          runId: record.runId as string,
          activityId: record.activityId,
          interruptionId: record.id,
          outcome: 'superseded' as const,
        },
      })),
      ...(params.previousActivityId
        ? [{
            runFence: params.runFence,
            idempotencyKey: `activity-completed:${params.previousActivityId}:before:${activityId}`,
            event: {
              kind: 'activity.completed' as const,
              runId: params.runId,
              activityId: params.previousActivityId,
            },
          }]
        : []),
      {
        runFence: params.runFence,
        idempotencyKey: `interruption-raised:${interruptionId}`,
        event: {
          kind: 'interruption.raised',
          runId: params.runId,
          activityId,
          interruptionId,
          interruptionKind: 'choice',
          operationId: params.operationId,
          approvalId: `choice:${randomUUID()}`,
          toolCallId: params.toolCallId,
          choiceType: offer.card.choiceType,
          payload: offer as unknown as Prisma.InputJsonValue,
          runState: null,
        },
      },
      ],
    })
  })
  if (supersededIds.length > 0) {
    projectAgentInterruptionLogger.warn({
      action: 'assistant.choice-interruption.superseded-by-new',
      message: 'Pending project agent interruptions superseded by a new choice interruption',
      projectId: params.projectId,
      userId: params.userId,
      details: { supersededIds },
    })
  }
  return offer
}

/**
 * Atomically consumes a pending approval interruption (pending -> consumed).
 * Returns null when the interruption is missing, already consumed, superseded,
 * or out of scope — callers must treat that as a protocol conflict, never guess.
 */
export async function consumeProjectAgentApprovalInterruption(params: ProjectAgentInterruptionScope & {
  runId: string
  interruptionId: string
  response: Prisma.InputJsonValue
}): Promise<ProjectAgentApprovalInterruptionRecord | null> {
  const { assistantId, scopeRef } = buildScope(params)
  const record = await prisma.projectAgentInterruption.findFirst({
    where: {
      id: params.interruptionId,
      runId: params.runId,
      projectId: params.projectId,
      userId: params.userId,
      assistantId,
      scopeRef,
      type: 'approval',
    },
  })
  if (!record || record.status !== 'pending' || !record.runState) return null

  try {
    await appendProjectAgentEvents({
      scope: params,
      events: [{
        runFence: createProjectAgentRunFence({
          id: params.runId,
          runVersion: record.runVersion,
          eventSeq: record.eventSeq,
        }),
        event: {
          kind: 'interruption.resolved',
          runId: params.runId,
          activityId: record.activityId,
          interruptionId: record.id,
          outcome: 'consumed',
          response: params.response,
        },
      }],
    })
  } catch (error) {
    if (isInterruptionConsumeRace(error)) return null
    throw error
  }

  return {
    id: record.id,
    runId: record.runId,
    activityId: record.activityId,
    type: 'approval',
    status: 'consumed',
    operationId: record.operationId,
    approvalId: record.approvalId,
    toolCallId: record.toolCallId,
    payload: record.payload,
    runState: record.runState,
  }
}

export async function getPendingProjectAgentApprovalInterruption(params: ProjectAgentInterruptionScope & {
  runId: string
}): Promise<Omit<ProjectAgentApprovalInterruptionRecord, 'runState'> | null> {
  const { assistantId, scopeRef } = buildScope(params)
  const record = await prisma.projectAgentInterruption.findFirst({
    where: {
      runId: params.runId,
      projectId: params.projectId,
      userId: params.userId,
      assistantId,
      scopeRef,
      type: 'approval',
      status: 'pending',
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      runId: true,
      activityId: true,
      type: true,
      status: true,
      operationId: true,
      approvalId: true,
      toolCallId: true,
      payload: true,
    },
  })
  if (!record) return null
  return {
    id: record.id,
    runId: record.runId,
    activityId: record.activityId,
    type: 'approval',
    status: 'pending',
    operationId: record.operationId,
    approvalId: record.approvalId,
    toolCallId: record.toolCallId,
    payload: record.payload,
  }
}

export async function getPendingProjectAgentInterruptionForScope(
  params: ProjectAgentInterruptionScope,
): Promise<ProjectAgentInterruptionSnapshot | null> {
  const { assistantId, scopeRef } = buildScope(params)
  const record = await prisma.projectAgentInterruption.findFirst({
    where: {
      projectId: params.projectId,
      userId: params.userId,
      assistantId,
      scopeRef,
      status: 'pending',
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      runId: true,
      activityId: true,
      type: true,
      status: true,
      operationId: true,
      approvalId: true,
      toolCallId: true,
      payload: true,
    },
  })
  return record ? toInterruptionSnapshot(record) : null
}

export async function getLatestProjectAgentInterruptionForRun(params: ProjectAgentInterruptionScope & {
  runId: string
}): Promise<ProjectAgentInterruptionSnapshot | null> {
  const { assistantId, scopeRef } = buildScope(params)
  const record = await prisma.projectAgentInterruption.findFirst({
    where: {
      runId: params.runId,
      projectId: params.projectId,
      userId: params.userId,
      assistantId,
      scopeRef,
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      runId: true,
      activityId: true,
      type: true,
      status: true,
      operationId: true,
      approvalId: true,
      toolCallId: true,
      payload: true,
    },
  })
  return record ? toInterruptionSnapshot(record) : null
}

export async function consumeProjectAgentChoiceInterruption(params: ProjectAgentInterruptionScope & {
  runId: string
  interruptionId: string
  cardId: string
  toolCallId: string
  response: Prisma.InputJsonValue
  latestUserText: string
}): Promise<(ProjectAgentChoiceInterruptionRecord & { parsedResponse: EditFirstChoiceDecision }) | null> {
  const { assistantId, scopeRef } = buildScope(params)
  try {
    return await prisma.$transaction(async (tx) => {
      const record = await tx.projectAgentInterruption.findFirst({
        where: {
          id: params.interruptionId,
          runId: params.runId,
          projectId: params.projectId,
          userId: params.userId,
          assistantId,
          scopeRef,
          type: 'choice',
        },
      })
      if (!record || record.status !== 'pending') return null
      const offer = parseProjectAgentChoiceOffer(record.payload)
      if (
        offer.card.interruptionId !== record.id
        || offer.card.runId !== params.runId
        || offer.card.cardId !== params.cardId
        || offer.card.toolCallId !== params.toolCallId
        || record.toolCallId !== params.toolCallId
      ) {
        throw new Error('PROJECT_AGENT_CHOICE_OFFER_IDENTITY_MISMATCH')
      }
      await assertProjectAgentChoiceOfferCurrent({
        tx,
        projectId: params.projectId,
        userId: params.userId,
        episodeId: params.episodeId,
        offer,
      })
      const parsedResponse = parseProjectAgentChoiceDecision({
        offer,
        response: params.response,
        latestUserText: params.latestUserText,
      })
      await appendProjectAgentEventsInTransaction(tx, {
        scope: {
          projectId: params.projectId,
          userId: params.userId,
          episodeId: params.episodeId ?? null,
          assistantId,
          scopeRef,
        },
        events: [{
          runFence: createProjectAgentRunFence({
            id: params.runId,
            runVersion: record.runVersion,
            eventSeq: record.eventSeq,
          }),
          event: {
            kind: 'interruption.resolved',
            runId: params.runId,
            activityId: record.activityId,
            interruptionId: record.id,
            outcome: 'consumed',
            response: JSON.parse(JSON.stringify(parsedResponse)) as Prisma.InputJsonValue,
          },
        }],
      })

      return {
        id: record.id,
        runId: record.runId,
        activityId: record.activityId,
        type: 'choice' as const,
        status: 'consumed' as const,
        operationId: record.operationId,
        toolCallId: record.toolCallId,
        payload: record.payload,
        offer,
        parsedResponse,
      }
    })
  } catch (error) {
    if (isInterruptionConsumeRace(error)) return null
    throw error
  }
}

/** Re-opens the exact consumed generation whose continuation failed to start. */
export async function reopenProjectAgentInterruption(interruptionId: string): Promise<void> {
  const interruption = await prisma.projectAgentInterruption.findUnique({
    where: {
      id: interruptionId,
    },
    select: {
      id: true,
      runId: true,
      activityId: true,
      projectId: true,
      userId: true,
      episodeId: true,
      assistantId: true,
      status: true,
      consumedAt: true,
      runVersion: true,
      eventSeq: true,
    },
  })
  if (!interruption?.runId || interruption.status !== 'consumed' || !interruption.consumedAt) {
    throw new Error(`PROJECT_AGENT_INTERRUPTION_NOT_CONSUMED:${interruptionId}`)
  }
  await appendProjectAgentEvents({
    scope: {
      projectId: interruption.projectId,
      userId: interruption.userId,
      episodeId: interruption.episodeId,
      assistantId: interruption.assistantId as ProjectAssistantId,
    },
    events: [{
      runFence: createProjectAgentRunFence({
        id: interruption.runId,
        runVersion: interruption.runVersion,
        eventSeq: interruption.eventSeq,
      }),
      idempotencyKey: `interruption-reopened:${interruption.id}:${interruption.consumedAt.toISOString()}`,
      event: {
        kind: 'interruption.reopened',
        runId: interruption.runId,
        activityId: interruption.activityId,
        interruptionId: interruption.id,
      },
    }],
  })
}

/**
 * Marks every pending interruption in the scope as superseded. Internal
 * replacement path: a newly created interruption displaces any older pending
 * one (a scope has at most one pending interruption). For the user-message
 * path use declinePendingProjectAgentInterruptionsForUserTurn, which records
 * the rejection decision instead. RunState is dropped.
 */
export interface SupersededProjectAgentInterruption {
  id: string
  approvalId: string
  runId: string | null
  activityId: string | null
}

export async function supersedePendingProjectAgentInterruptions(
  scope: ProjectAgentInterruptionScope & { runFence?: ProjectAgentRunFence },
): Promise<SupersededProjectAgentInterruption[]> {
  const { assistantId, scopeRef } = buildScope(scope)
  const pending = await prisma.projectAgentInterruption.findMany({
    where: {
      projectId: scope.projectId,
      userId: scope.userId,
      assistantId,
      scopeRef,
      status: 'pending',
    },
    select: {
      id: true,
      approvalId: true,
      runId: true,
      activityId: true,
      runVersion: true,
      eventSeq: true,
    },
  })
  if (pending.length === 0) return []
  if (pending.some((record) => !record.runId)) {
    throw new Error('PROJECT_AGENT_PENDING_INTERRUPTION_RUN_ID_MISSING')
  }
  await appendProjectAgentEvents({
    scope,
    events: pending.map((record) => ({
        runFence: scope.runFence?.runId === record.runId
          ? scope.runFence
          : createProjectAgentRunFence({
              id: record.runId as string,
              runVersion: record.runVersion,
              eventSeq: record.eventSeq,
            }),
        idempotencyKey: `interruption-resolved:${record.id}:superseded`,
        event: {
          kind: 'interruption.resolved' as const,
          runId: record.runId as string,
          activityId: record.activityId,
          interruptionId: record.id,
          outcome: 'superseded' as const,
        },
      })),
  })
  return pending
}

export interface DeclinedProjectAgentInterruption {
  id: string
  approvalId: string
  runId: string | null
  activityId: string | null
  type: ProjectAgentInterruptionType
  operationId: string
}

/**
 * Resolves every pending interruption in the scope when the user sends a
 * fresh message instead of answering the card. Unified control semantics:
 * any non-approve response to a pending approval is a rejection. Approvals
 * are therefore consumed with {approved:false, via:'user_message'} so the
 * decision stays an auditable control fact, and the caller projects it into
 * the next run's model input. Choice interruptions carry no reject semantics
 * and are superseded. RunState is dropped in both cases — the old run must
 * never be resumable again.
 */
export async function declinePendingProjectAgentInterruptionsForUserTurn(
  scope: ProjectAgentInterruptionScope,
): Promise<DeclinedProjectAgentInterruption[]> {
  const { assistantId, scopeRef } = buildScope(scope)
  const pending = await prisma.projectAgentInterruption.findMany({
    where: {
      projectId: scope.projectId,
      userId: scope.userId,
      assistantId,
      scopeRef,
      status: 'pending',
    },
    select: {
      id: true,
      approvalId: true,
      runId: true,
      activityId: true,
      type: true,
      operationId: true,
      runVersion: true,
      eventSeq: true,
    },
  })
  if (pending.length === 0) return []
  if (pending.some((record) => !record.runId)) {
    throw new Error('PROJECT_AGENT_PENDING_INTERRUPTION_RUN_ID_MISSING')
  }

  await appendProjectAgentEvents({
    scope,
    events: pending.map((record) => {
      const isApproval = record.type === 'approval'
      return {
        runFence: createProjectAgentRunFence({
          id: record.runId as string,
          runVersion: record.runVersion,
          eventSeq: record.eventSeq,
        }),
        idempotencyKey: `interruption-resolved:${record.id}:${isApproval ? 'consumed' : 'superseded'}`,
        event: {
          kind: 'interruption.resolved' as const,
          runId: record.runId as string,
          activityId: record.activityId,
          interruptionId: record.id,
          outcome: isApproval ? 'consumed' as const : 'superseded' as const,
          ...(isApproval
            ? {
                response: {
                  approved: false,
                  via: 'user_message',
                } satisfies Prisma.InputJsonObject,
              }
            : {}),
        },
      }
    }),
  })
  return pending.map((record) => ({
    id: record.id,
    approvalId: record.approvalId,
    runId: record.runId,
    activityId: record.activityId,
    type: record.type as ProjectAgentInterruptionType,
    operationId: record.operationId,
  }))
}

/**
 * Drops the serialized RunState of a consumed interruption once its
 * continuation run has finished. The row stays for audit; the heavy and
 * security-sensitive state does not.
 */
export async function clearProjectAgentInterruptionRunState(interruptionId: string): Promise<void> {
  try {
    await prisma.projectAgentInterruption.updateMany({
      where: { id: interruptionId },
      data: { runState: null },
    })
  } catch (error) {
    projectAgentInterruptionLogger.error({
      action: 'assistant.interruption.clear-run-state.failed',
      message: 'Failed to clear project agent interruption run state',
      details: {
        interruptionId,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }
}
