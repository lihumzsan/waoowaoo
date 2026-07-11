import { isDeepStrictEqual } from 'node:util'
import { Prisma } from '@prisma/client'
import type { UIMessage } from 'ai'
import { prisma } from '@/lib/prisma'
import type { ProjectAssistantId } from './types'
import {
  appendProjectAssistantThreadMessagesInTransaction,
  buildProjectAssistantScopeRef,
} from './persistence'
import { appendProjectAgentEventsInTransaction } from './event'
import {
  assertProjectAgentChoiceOfferCurrent,
  parseProjectAgentChoiceDecision,
  parseProjectAgentChoiceOffer,
  type ProjectAgentChoiceOffer,
} from './choice-offer'
import type { EditFirstChoiceDecision } from './edit-first-choice-result'
import {
  createProjectAgentRunFence,
  type ProjectAgentRunFence,
} from './run-fence'
import type { ProjectAgentEventInput, ProjectAgentEventScopeRef } from './event/types'

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

interface PendingProjectAgentInterruptionForReplacement {
  id: string
  runId: string
  activityId: string | null
  runVersion: number
  eventSeq: bigint
}

export async function appendProjectAgentInterruptionReplacementInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    scope: ProjectAgentEventScopeRef
    runId: string
    runFence: ProjectAgentRunFence
    nextActivityId: string
    raisedEvent: ProjectAgentEventInput
    beforeAppend?: () => Promise<void>
  },
): Promise<string[]> {
  const lockedRun = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM project_agent_runs
    WHERE id = ${params.runId}
    FOR UPDATE
  `)
  if (lockedRun.length !== 1) {
    throw new Error(`PROJECT_AGENT_INTERRUPTION_RUN_LOCK_FAILED:${params.runId}`)
  }

  await params.beforeAppend?.()

  const pendingRecords = await tx.projectAgentInterruption.findMany({
    where: {
      projectId: params.scope.projectId,
      userId: params.scope.userId,
      assistantId: params.scope.assistantId,
      scopeRef: params.scope.scopeRef,
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
  const pending: PendingProjectAgentInterruptionForReplacement[] = pendingRecords.map((record) => {
    if (!record.runId) {
      throw new Error('PROJECT_AGENT_PENDING_INTERRUPTION_RUN_ID_MISSING')
    }
    return {
      ...record,
      runId: record.runId,
    }
  })

  await appendProjectAgentEventsInTransaction(tx, {
    scope: params.scope,
    events: [
      ...pending.map((record) => ({
        runFence: record.runId === params.runId
          ? params.runFence
          : createProjectAgentRunFence({
              id: record.runId,
              runVersion: record.runVersion,
              eventSeq: record.eventSeq,
            }),
        idempotencyKey: `interruption-resolved:${record.id}:superseded`,
        event: {
          kind: 'interruption.resolved' as const,
          runId: record.runId,
          activityId: record.activityId,
          interruptionId: record.id,
          outcome: 'superseded' as const,
        },
      })),
      params.raisedEvent,
    ],
  })
  return pending.map((record) => record.id)
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
 * Atomically consumes a pending approval interruption (pending -> consumed).
 * Returns null when the interruption is missing, already consumed, superseded,
 * or out of scope — callers must treat that as a protocol conflict, never guess.
 */
export async function consumeProjectAgentApprovalInterruption(params: ProjectAgentInterruptionScope & {
  runId: string
  interruptionId: string
  response: Prisma.InputJsonValue
  visibleMessages?: UIMessage[]
}): Promise<ProjectAgentApprovalInterruptionRecord | null> {
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
          type: 'approval',
        },
      })
      if (!record || record.status !== 'pending' || !record.runState) return null
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
            response: params.response,
          },
        }],
      })
      if (params.visibleMessages?.length) {
        await appendProjectAssistantThreadMessagesInTransaction(tx, {
          projectId: params.projectId,
          userId: params.userId,
          episodeId: params.episodeId ?? null,
          assistantId,
          messages: params.visibleMessages,
        })
      }
      return {
        id: record.id,
        runId: record.runId,
        activityId: record.activityId,
        type: 'approval' as const,
        status: 'consumed' as const,
        operationId: record.operationId,
        approvalId: record.approvalId,
        toolCallId: record.toolCallId,
        payload: record.payload,
        runState: record.runState,
      }
    })
  } catch (error) {
    if (isInterruptionConsumeRace(error)) return null
    throw error
  }
}

export async function readRetryableConsumedProjectAgentApprovalInterruption(
  params: ProjectAgentInterruptionScope & {
    runId: string
    interruptionId: string
    response: Prisma.InputJsonValue
    visibleMessages?: UIMessage[]
  },
): Promise<ProjectAgentApprovalInterruptionRecord | null> {
  const { assistantId, scopeRef } = buildScope(params)
  return await prisma.$transaction(async (tx) => {
  const record = await tx.projectAgentInterruption.findFirst({
    where: {
      id: params.interruptionId,
      runId: params.runId,
      projectId: params.projectId,
      userId: params.userId,
      assistantId,
      scopeRef,
      type: 'approval',
      status: 'consumed',
    },
  })
  if (!record?.runState || !isDeepStrictEqual(record.response, params.response)) return null
  if (params.visibleMessages?.length) {
    await appendProjectAssistantThreadMessagesInTransaction(tx, {
      projectId: params.projectId,
      userId: params.userId,
      episodeId: params.episodeId ?? null,
      assistantId,
      messages: params.visibleMessages,
    })
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
  })
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
  visibleMessages?: UIMessage[]
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
      if (params.visibleMessages?.length) {
        await appendProjectAssistantThreadMessagesInTransaction(tx, {
          projectId: params.projectId,
          userId: params.userId,
          episodeId: params.episodeId ?? null,
          assistantId,
          messages: params.visibleMessages,
        })
      }

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

export async function readRetryableConsumedProjectAgentChoiceInterruption(
  params: ProjectAgentInterruptionScope & {
    runId: string
    interruptionId: string
    cardId: string
    toolCallId: string
    response: Prisma.InputJsonValue
    latestUserText: string
    visibleMessages?: UIMessage[]
  },
): Promise<(ProjectAgentChoiceInterruptionRecord & { parsedResponse: EditFirstChoiceDecision }) | null> {
  const { assistantId, scopeRef } = buildScope(params)
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
        status: 'consumed',
      },
    })
    if (!record?.response) return null
    const offer = parseProjectAgentChoiceOffer(record.payload)
    if (
      offer.card.interruptionId !== record.id
      || offer.card.runId !== params.runId
      || offer.card.cardId !== params.cardId
      || offer.card.toolCallId !== params.toolCallId
      || record.toolCallId !== params.toolCallId
    ) return null
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
    if (!isDeepStrictEqual(record.response, parsedResponse)) return null
    if (params.visibleMessages?.length) {
      await appendProjectAssistantThreadMessagesInTransaction(tx, {
        projectId: params.projectId,
        userId: params.userId,
        episodeId: params.episodeId ?? null,
        assistantId,
        messages: params.visibleMessages,
      })
    }
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
}

export interface DeclinedProjectAgentInterruption {
  id: string
  approvalId: string
  runId: string | null
  activityId: string | null
  type: ProjectAgentInterruptionType
  operationId: string
}
