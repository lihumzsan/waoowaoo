import { prisma } from '@/lib/prisma'
import { buildProjectAssistantScopeRef } from '../persistence'
import type { ProjectAssistantId } from '../types'
import {
  type ProjectAgentActivitySnapshot,
  normalizeProjectAgentActivityStatus,
  normalizeProjectAgentActivityType,
} from './types'

const OPEN_ACTIVITY_STATUSES = ['running', 'waiting'] as const

export async function getCurrentProjectAgentActivity(input: {
  projectId: string
  userId: string
  episodeId?: string | null
  assistantId?: ProjectAssistantId
  runId?: string | null
}): Promise<ProjectAgentActivitySnapshot | null> {
  const assistantId = input.assistantId ?? 'workspace-command'
  const scopeRef = buildProjectAssistantScopeRef({
    projectId: input.projectId,
    episodeId: input.episodeId ?? null,
  })
  const activity = await prisma.projectAgentActivity.findFirst({
    where: {
      projectId: input.projectId,
      userId: input.userId,
      assistantId,
      scopeRef,
      ...(input.runId ? { runId: input.runId } : {}),
      status: { in: [...OPEN_ACTIVITY_STATUSES] },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      runId: true,
      type: true,
      status: true,
      operationId: true,
      sourceOperationId: true,
      toolCallId: true,
    },
  })
  if (!activity) return null
  return {
    activityId: activity.id,
    runId: activity.runId,
    type: normalizeProjectAgentActivityType(activity.type),
    status: normalizeProjectAgentActivityStatus(activity.status),
    operationId: activity.operationId,
    sourceOperationId: activity.sourceOperationId,
    toolCallId: activity.toolCallId,
  }
}
