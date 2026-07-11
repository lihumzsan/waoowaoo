import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { getProjectChannel } from '@/lib/task/publisher'
import {
  WORKSPACE_SSE_EVENT_TYPE,
  type AssistantSessionChangedSSEEvent,
} from '@/lib/task/types'
import { buildProjectAssistantScopeRef } from './persistence'

type ProjectAgentSessionEventRow = {
  id: bigint
  projectId: string
  userId: string
  assistantId: string
  scopeRef: string
  episodeId: string | null
  createdAt: Date
}

function parseAgentEventId(value: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error('PROJECT_AGENT_SESSION_EVENT_ID_INVALID')
  }
  return BigInt(value)
}

export function buildProjectAgentSessionChangedSseEvent(
  row: ProjectAgentSessionEventRow,
): AssistantSessionChangedSSEEvent {
  const agentEventId = row.id.toString()
  return {
    id: `agent:${agentEventId}`,
    type: WORKSPACE_SSE_EVENT_TYPE.ASSISTANT_SESSION_CHANGED,
    projectId: row.projectId,
    userId: row.userId,
    ts: row.createdAt.toISOString(),
    episodeId: row.episodeId,
    assistantId: row.assistantId,
    scopeRef: row.scopeRef,
    agentEventId,
  }
}

export async function publishPersistedProjectAgentSessionChangedById(
  projectAgentEventId: string,
): Promise<void> {
  const id = parseAgentEventId(projectAgentEventId)
  if (id === BigInt(0)) throw new Error('PROJECT_AGENT_SESSION_EVENT_ID_NOT_POSITIVE')
  const row = await prisma.projectAgentEvent.findUnique({
    where: { id },
    select: {
      id: true,
      projectId: true,
      userId: true,
      assistantId: true,
      scopeRef: true,
      episodeId: true,
      createdAt: true,
    },
  })
  if (!row) throw new Error(`PROJECT_AGENT_SESSION_EVENT_NOT_FOUND:${projectAgentEventId}`)
  const event = buildProjectAgentSessionChangedSseEvent(row)
  await redis.publish(getProjectChannel(row.projectId), JSON.stringify(event))
}

export async function listLatestProjectAgentSessionChangedEvent(params: {
  projectId: string
  userId: string
  episodeId: string | null
  assistantId: string
  afterEventId: string
}): Promise<AssistantSessionChangedSSEEvent[]> {
  const afterEventId = parseAgentEventId(params.afterEventId)
  const scopeRef = buildProjectAssistantScopeRef({
    projectId: params.projectId,
    episodeId: params.episodeId,
  })
  const row = await prisma.projectAgentEvent.findFirst({
    where: {
      projectId: params.projectId,
      userId: params.userId,
      assistantId: params.assistantId,
      scopeRef,
      id: { gt: afterEventId },
    },
    orderBy: { id: 'desc' },
    select: {
      id: true,
      projectId: true,
      userId: true,
      assistantId: true,
      scopeRef: true,
      episodeId: true,
      createdAt: true,
    },
  })
  return row ? [buildProjectAgentSessionChangedSseEvent(row)] : []
}

export async function readProjectAgentSessionEventWatermark(params: {
  projectId: string
  userId: string
  episodeId?: string | null
  assistantId: string
}): Promise<string> {
  const scopeRef = buildProjectAssistantScopeRef({
    projectId: params.projectId,
    episodeId: params.episodeId,
  })
  const row = await prisma.projectAgentEvent.findFirst({
    where: {
      projectId: params.projectId,
      userId: params.userId,
      assistantId: params.assistantId,
      scopeRef,
    },
    orderBy: { id: 'desc' },
    select: { id: true },
  })
  return row?.id.toString() ?? '0'
}
