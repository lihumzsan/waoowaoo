import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildProjectAssistantScopeRef } from '../persistence'
import {
  type ProjectAgentActivitySnapshot,
  type ProjectAgentEventInput,
  type ProjectAgentEventPayload,
  type ProjectAgentPersistedEventPayload,
  type ProjectAgentEventScope,
  type ProjectAgentEventScopeRef,
} from './types'
import { reduceProjectAgentEvent } from './reducer'
import {
  advanceProjectAgentRunFence,
  assignProjectAgentRunFence,
  type ProjectAgentRunFence,
} from '../run-fence'

export type ProjectAgentEventTransactionClient = Prisma.TransactionClient

function resolveEventScope(input: ProjectAgentEventScope): ProjectAgentEventScopeRef {
  const assistantId = input.assistantId ?? 'workspace-command'
  const episodeId = input.episodeId ?? null
  return {
    projectId: input.projectId,
    userId: input.userId,
    episodeId,
    assistantId,
    scopeRef: buildProjectAssistantScopeRef({
      projectId: input.projectId,
      episodeId,
    }),
  }
}

function eventRunId(event: ProjectAgentEventPayload): string {
  return event.runId
}

function eventActivityId(event: ProjectAgentEventPayload): string | null {
  return 'activityId' in event ? event.activityId : null
}

function toInputJsonValue(value: ProjectAgentPersistedEventPayload): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

export async function appendProjectAgentEvents(params: {
  scope: ProjectAgentEventScope
  events: ProjectAgentEventInput[]
}): Promise<ProjectAgentActivitySnapshot | null> {
  if (params.events.length === 0) return null
  const scope = resolveEventScope(params.scope)

  return await prisma.$transaction(async (tx) => appendProjectAgentEventsInTransaction(tx, {
    scope,
    events: params.events,
  }))
}

export async function appendProjectAgentEventsInTransaction(
  tx: ProjectAgentEventTransactionClient,
  params: {
    scope: ProjectAgentEventScopeRef
    events: ProjectAgentEventInput[]
  },
): Promise<ProjectAgentActivitySnapshot | null> {
  let lastActivity: ProjectAgentActivitySnapshot | null = null
  const initialFenceByRun = new Map<string, ProjectAgentRunFence>()
  const currentFenceByRun = new Map<string, ProjectAgentRunFence>()
  const targetFencesByRun = new Map<string, Set<ProjectAgentRunFence>>()
  for (const item of params.events) {
    const runId = eventRunId(item.event)
    if (item.runFence.runId !== runId) {
      throw new Error(`PROJECT_AGENT_EVENT_RUN_FENCE_MISMATCH eventRunId=${runId} fenceRunId=${item.runFence.runId}`)
    }
    const initialFence = initialFenceByRun.get(runId)
    if (!initialFence) {
      const copied = { ...item.runFence }
      initialFenceByRun.set(runId, copied)
      currentFenceByRun.set(runId, copied)
      targetFencesByRun.set(runId, new Set([item.runFence]))
    } else {
      if (
        item.runFence.runVersion !== initialFence.runVersion
        || item.runFence.eventSeq !== initialFence.eventSeq
      ) {
        throw new Error(`PROJECT_AGENT_EVENT_BATCH_FENCE_MISMATCH runId=${runId}`)
      }
      targetFencesByRun.get(runId)?.add(item.runFence)
    }
    const expectedFence = currentFenceByRun.get(runId)
    if (!expectedFence) throw new Error(`PROJECT_AGENT_EVENT_FENCE_MISSING runId=${runId}`)
    const idempotencyKey = item.idempotencyKey?.trim() || null
    if (idempotencyKey) {
      const existing = await tx.projectAgentEvent.findUnique({
        where: { idempotencyKey },
        select: { id: true, payload: true },
      })
      if (existing) {
        const payload = existing.payload as Partial<ProjectAgentPersistedEventPayload>
        if (
          payload.expectedRunVersion !== expectedFence.runVersion
          || payload.expectedEventSeq !== expectedFence.eventSeq
        ) {
          throw new Error(`PROJECT_AGENT_EVENT_IDEMPOTENCY_FENCE_CONFLICT key=${idempotencyKey} runId=${runId}`)
        }
        currentFenceByRun.set(runId, advanceProjectAgentRunFence(expectedFence, existing.id))
        continue
      }
    }

    const persistedPayload: ProjectAgentPersistedEventPayload = {
      ...item.event,
      expectedRunVersion: expectedFence.runVersion,
      expectedEventSeq: expectedFence.eventSeq,
    }
    const createdEvent = await tx.projectAgentEvent.create({
      data: {
        projectId: params.scope.projectId,
        userId: params.scope.userId,
        assistantId: params.scope.assistantId,
        scopeRef: params.scope.scopeRef,
        episodeId: params.scope.episodeId,
        runId,
        activityId: eventActivityId(item.event),
        kind: item.event.kind,
        idempotencyKey,
        payload: toInputJsonValue(persistedPayload),
      },
      select: { id: true },
    })
    lastActivity = await reduceProjectAgentEvent({
      tx,
      scope: params.scope,
      event: item.event,
      eventId: createdEvent.id,
      expectedFence,
    }) ?? lastActivity
    currentFenceByRun.set(runId, advanceProjectAgentRunFence(expectedFence, createdEvent.id))
  }
  for (const [runId, targets] of targetFencesByRun) {
    const finalFence = currentFenceByRun.get(runId)
    if (!finalFence) throw new Error(`PROJECT_AGENT_EVENT_FINAL_FENCE_MISSING runId=${runId}`)
    for (const target of targets) assignProjectAgentRunFence(target, finalFence)
  }
  return lastActivity
}
