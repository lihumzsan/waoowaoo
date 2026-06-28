import { prisma } from '@/lib/prisma'
import { createScopedLogger } from '@/lib/logging/core'
import type { ProjectAssistantId } from './types'
import { buildProjectAssistantScopeRef } from './persistence'

export type ProjectAgentRunStatus =
  | 'running'
  | 'awaiting_approval'
  | 'awaiting_choice'
  | 'awaiting_task'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type ProjectAgentRunControlKind =
  | 'user_turn'
  | 'approval_response'
  | 'choice_response'
  | 'task_follow_up'

export interface ProjectAgentRunScope {
  projectId: string
  userId: string
  episodeId?: string | null
  assistantId?: ProjectAssistantId
}

export interface ProjectAgentRunRecord {
  id: string
  projectId: string
  userId: string
  assistantId: string
  scopeRef: string
  episodeId: string | null
  requestId: string
  status: ProjectAgentRunStatus
  controlKind: ProjectAgentRunControlKind
}

// Matches the run lock TTL; once both expire with no durable wait, the run is orphaned.
export const PROJECT_AGENT_STALE_RUNNING_RECONCILE_MS = 10 * 60 * 1000

const PROJECT_AGENT_ACTIVE_WAIT_STATUSES = ['pending', 'resolved', 'claimed'] as const
const PROJECT_AGENT_STALE_RUNNING_ERROR_MESSAGE = 'Project agent run stayed running without a pending approval, choice, or task wait.'

const projectAgentRunLogger = createScopedLogger({
  module: 'project-agent.runs',
})

function buildRunScope(scope: ProjectAgentRunScope): {
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

function normalizeRunStatus(value: string): ProjectAgentRunStatus {
  if (
    value === 'running'
    || value === 'awaiting_approval'
    || value === 'awaiting_choice'
    || value === 'awaiting_task'
    || value === 'completed'
    || value === 'failed'
    || value === 'cancelled'
  ) return value
  throw new Error(`PROJECT_AGENT_RUN_STATUS_INVALID:${value}`)
}

function normalizeControlKind(value: string): ProjectAgentRunControlKind {
  if (
    value === 'user_turn'
    || value === 'approval_response'
    || value === 'choice_response'
    || value === 'task_follow_up'
  ) return value
  throw new Error(`PROJECT_AGENT_RUN_CONTROL_KIND_INVALID:${value}`)
}

export async function createProjectAgentRun(params: ProjectAgentRunScope & {
  requestId: string
  controlKind: ProjectAgentRunControlKind
}): Promise<ProjectAgentRunRecord> {
  const { assistantId, scopeRef } = buildRunScope(params)
  const run = await prisma.projectAgentRun.create({
    data: {
      projectId: params.projectId,
      userId: params.userId,
      assistantId,
      scopeRef,
      episodeId: params.episodeId ?? null,
      requestId: params.requestId,
      status: 'running',
      controlKind: params.controlKind,
    },
    select: {
      id: true,
      projectId: true,
      userId: true,
      assistantId: true,
      scopeRef: true,
      episodeId: true,
      requestId: true,
      status: true,
      controlKind: true,
    },
  })
  return {
    ...run,
    status: normalizeRunStatus(run.status),
    controlKind: normalizeControlKind(run.controlKind),
  }
}

export async function getProjectAgentRun(params: ProjectAgentRunScope & {
  runId: string
}): Promise<ProjectAgentRunRecord | null> {
  const { assistantId, scopeRef } = buildRunScope(params)
  const run = await prisma.projectAgentRun.findFirst({
    where: {
      id: params.runId,
      projectId: params.projectId,
      userId: params.userId,
      assistantId,
      scopeRef,
    },
    select: {
      id: true,
      projectId: true,
      userId: true,
      assistantId: true,
      scopeRef: true,
      episodeId: true,
      requestId: true,
      status: true,
      controlKind: true,
    },
  })
  if (!run) return null
  return {
    ...run,
    status: normalizeRunStatus(run.status),
    controlKind: normalizeControlKind(run.controlKind),
  }
}

export async function listRecentProjectAgentRunsForScope(params: ProjectAgentRunScope & {
  limit?: number
}): Promise<ProjectAgentRunRecord[]> {
  const { assistantId, scopeRef } = buildRunScope(params)
  const limit = Math.min(Math.max(Math.floor(params.limit ?? 10), 1), 50)
  const runs = await prisma.projectAgentRun.findMany({
    where: {
      projectId: params.projectId,
      userId: params.userId,
      assistantId,
      scopeRef,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      projectId: true,
      userId: true,
      assistantId: true,
      scopeRef: true,
      episodeId: true,
      requestId: true,
      status: true,
      controlKind: true,
    },
  })
  return runs.map((run) => ({
    ...run,
    status: normalizeRunStatus(run.status),
    controlKind: normalizeControlKind(run.controlKind),
  }))
}

export async function reconcileStaleRunningProjectAgentRunsForScope(params: ProjectAgentRunScope & {
  now?: Date
}): Promise<string[]> {
  const { assistantId, scopeRef } = buildRunScope(params)
  const now = params.now ?? new Date()
  const staleBefore = new Date(now.getTime() - PROJECT_AGENT_STALE_RUNNING_RECONCILE_MS)
  const staleRuns = await prisma.projectAgentRun.findMany({
    where: {
      projectId: params.projectId,
      userId: params.userId,
      assistantId,
      scopeRef,
      status: 'running',
      updatedAt: {
        lt: staleBefore,
      },
      interruptions: {
        none: {
          status: 'pending',
        },
      },
      waits: {
        none: {
          status: {
            in: [...PROJECT_AGENT_ACTIVE_WAIT_STATUSES],
          },
        },
      },
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: 20,
  })
  if (staleRuns.length === 0) return []

  const ids = staleRuns.map((run) => run.id)
  await prisma.projectAgentRun.updateMany({
    where: {
      id: { in: ids },
      status: 'running',
    },
    data: {
      status: 'failed',
      stopReason: 'stale_running_reconciled',
      errorCode: 'PROJECT_AGENT_STALE_RUNNING_RECONCILED',
      errorMessage: PROJECT_AGENT_STALE_RUNNING_ERROR_MESSAGE,
      failedAt: now,
    },
  })
  return ids
}

export async function updateProjectAgentRunStatus(params: {
  runId: string
  status: ProjectAgentRunStatus
  stopReason?: string | null
  errorCode?: string | null
  errorMessage?: string | null
}): Promise<void> {
  const now = new Date()
  await prisma.projectAgentRun.updateMany({
    where: { id: params.runId },
    data: {
      status: params.status,
      stopReason: params.stopReason ?? null,
      errorCode: params.errorCode ?? null,
      errorMessage: params.errorMessage ?? null,
      ...(params.status === 'completed' ? { completedAt: now } : {}),
      ...(params.status === 'failed' ? { failedAt: now } : {}),
      ...(params.status === 'cancelled' ? { cancelledAt: now } : {}),
    },
  })
}

export async function safelyUpdateProjectAgentRunStatus(params: {
  runId: string | null | undefined
  status: ProjectAgentRunStatus
  stopReason?: string | null
  errorCode?: string | null
  errorMessage?: string | null
}): Promise<void> {
  if (!params.runId) return
  try {
    await updateProjectAgentRunStatus({
      runId: params.runId,
      status: params.status,
      stopReason: params.stopReason,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
    })
  } catch (error) {
    projectAgentRunLogger.error({
      action: 'assistant.run.status-update.failed',
      message: 'Failed to update project agent run status',
      details: {
        runId: params.runId,
        status: params.status,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

export async function supersedePendingRunsInScope(scope: ProjectAgentRunScope): Promise<string[]> {
  const { assistantId, scopeRef } = buildRunScope(scope)
  const pending = await prisma.projectAgentRun.findMany({
    where: {
      projectId: scope.projectId,
      userId: scope.userId,
      assistantId,
      scopeRef,
      status: {
        in: ['awaiting_approval', 'awaiting_choice', 'awaiting_task'],
      },
    },
    select: { id: true },
  })
  if (pending.length === 0) return []
  const ids = pending.map((run) => run.id)
  await prisma.projectAgentRun.updateMany({
    where: {
      id: { in: ids },
      status: {
        in: ['awaiting_approval', 'awaiting_choice', 'awaiting_task'],
      },
    },
    data: {
      status: 'cancelled',
      stopReason: 'superseded',
      cancelledAt: new Date(),
    },
  })
  return ids
}
