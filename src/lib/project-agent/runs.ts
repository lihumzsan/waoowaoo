import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { createScopedLogger } from '@/lib/logging/core'
import type { ProjectAssistantId } from './types'
import { buildProjectAssistantScopeRef } from './persistence'
import { isProjectAgentRunLockActive } from './run-lock'
import { appendProjectAgentEvents } from './event'

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
  stopReason?: string | null
}

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
  const runId = randomUUID()
  await appendProjectAgentEvents({
    scope: params,
    events: [{
      idempotencyKey: `run-started:${runId}`,
      event: {
        kind: 'run.started',
        runId,
        requestId: params.requestId,
        controlKind: params.controlKind,
      },
    }],
  })
  const run = await getProjectAgentRun({
    ...params,
    runId,
  })
  if (!run) throw new Error(`PROJECT_AGENT_RUN_CREATE_FAILED:${runId}`)
  return run
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
      stopReason: true,
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
      stopReason: true,
    },
  })
  return runs.map((run) => ({
    ...run,
    status: normalizeRunStatus(run.status),
    controlKind: normalizeControlKind(run.controlKind),
  }))
}

export async function updateProjectAgentRunStatus(params: {
  runId: string
  status: ProjectAgentRunStatus
  stopReason?: string | null
  errorCode?: string | null
  errorMessage?: string | null
}): Promise<void> {
  const run = await prisma.projectAgentRun.findUnique({
    where: { id: params.runId },
    select: {
      projectId: true,
      userId: true,
      episodeId: true,
      assistantId: true,
    },
  })
  if (!run) throw new Error(`PROJECT_AGENT_RUN_NOT_FOUND:${params.runId}`)
  await appendProjectAgentEvents({
    scope: {
      projectId: run.projectId,
      userId: run.userId,
      episodeId: run.episodeId,
      assistantId: run.assistantId as ProjectAssistantId,
    },
    events: [{
      event: {
        kind: 'run.status_changed',
        runId: params.runId,
        status: params.status,
        stopReason: params.stopReason,
        errorCode: params.errorCode,
        errorMessage: params.errorMessage,
      },
    }],
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

export async function cancelRunningProjectAgentRun(params: {
  runId: string
  stopReason: string
  errorCode?: string | null
  errorMessage?: string | null
}): Promise<boolean> {
  const run = await prisma.projectAgentRun.findFirst({
    where: {
      id: params.runId,
      status: 'running',
    },
    select: {
      id: true,
      projectId: true,
      userId: true,
      episodeId: true,
      assistantId: true,
    },
  })
  if (!run) return false
  await appendProjectAgentEvents({
    scope: {
      projectId: run.projectId,
      userId: run.userId,
      episodeId: run.episodeId,
      assistantId: run.assistantId as ProjectAssistantId,
    },
    events: [{
      idempotencyKey: `run-cancelled:${run.id}:${params.stopReason}`,
      event: {
        kind: 'run.cancelled',
        runId: run.id,
        reason: params.stopReason,
      },
    }],
  })
  return true
}

export async function safelyCancelRunningProjectAgentRun(params: {
  runId: string | null | undefined
  stopReason: string
  errorCode?: string | null
  errorMessage?: string | null
}): Promise<void> {
  if (!params.runId) return
  try {
    await cancelRunningProjectAgentRun({
      runId: params.runId,
      stopReason: params.stopReason,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
    })
  } catch (error) {
    projectAgentRunLogger.error({
      action: 'assistant.run.cancel-running.failed',
      message: 'Failed to cancel running project agent run',
      details: {
        runId: params.runId,
        stopReason: params.stopReason,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

export async function cancelUnlockedRunningProjectAgentRunsForScope(scope: ProjectAgentRunScope): Promise<string[]> {
  const { assistantId, scopeRef } = buildRunScope(scope)
  const runningRuns = await prisma.projectAgentRun.findMany({
    where: {
      projectId: scope.projectId,
      userId: scope.userId,
      assistantId,
      scopeRef,
      status: 'running',
    },
    select: { id: true },
  })
  if (runningRuns.length === 0) return []
  if (await isProjectAgentRunLockActive(scope)) return []

  const runIds = runningRuns.map((run) => run.id)
  await Promise.all(runIds.map((runId) => updateProjectAgentRunStatus({
    runId,
    status: 'cancelled',
    stopReason: 'orphaned_running_run',
  })))
  return runIds
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
  await Promise.all(ids.map((runId) => updateProjectAgentRunStatus({
    runId,
    status: 'cancelled',
    stopReason: 'superseded',
  })))
  return ids
}
