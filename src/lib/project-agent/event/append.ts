import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildProjectAssistantScopeRef } from '../persistence'
import {
  type ProjectAgentActivitySnapshot,
  type ProjectAgentEventInput,
  type ProjectAgentEventPayload,
  type ProjectAgentEventScope,
  type ProjectAgentEventScopeRef,
} from './types'
import { reduceProjectAgentEvent } from './reducer'

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

function eventRunId(event: ProjectAgentEventPayload): string | null {
  return 'runId' in event ? event.runId : null
}

function eventActivityId(event: ProjectAgentEventPayload): string | null {
  return 'activityId' in event ? event.activityId : null
}

function toInputJsonValue(value: ProjectAgentEventPayload): Prisma.InputJsonValue {
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
  for (const item of params.events) {
    const idempotencyKey = item.idempotencyKey?.trim() || null
    if (idempotencyKey) {
      const existing = await tx.projectAgentEvent.findUnique({
        where: { idempotencyKey },
        select: { id: true },
      })
      if (existing) continue
    }

    await tx.projectAgentEvent.create({
      data: {
        projectId: params.scope.projectId,
        userId: params.scope.userId,
        assistantId: params.scope.assistantId,
        scopeRef: params.scope.scopeRef,
        episodeId: params.scope.episodeId,
        runId: eventRunId(item.event),
        activityId: eventActivityId(item.event),
        kind: item.event.kind,
        idempotencyKey,
        payload: toInputJsonValue(item.event),
      },
    })
    lastActivity = await reduceProjectAgentEvent({
      tx,
      scope: params.scope,
      event: item.event,
    }) ?? lastActivity
  }
  return lastActivity
}
