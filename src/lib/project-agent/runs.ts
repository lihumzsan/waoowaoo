import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import type { UIMessage } from 'ai'
import { prisma } from '@/lib/prisma'
import { createScopedLogger } from '@/lib/logging/core'
import type { ProjectAssistantId } from './types'
import {
  appendProjectAssistantThreadMessagesInTransaction,
  buildProjectAssistantScopeRef,
  discardProjectAssistantPendingModelHistoryInTransaction,
  type ProjectAssistantModelHistoryCommit,
} from './persistence'
import { releaseProjectAgentRunLockForRun } from './run-lock'
import {
  appendProjectAgentEvents,
  appendProjectAgentEventsInTransaction,
  type ProjectAgentEventTransactionClient,
  type ProjectAgentEventInput,
} from './event'
import { normalizeProjectAgentRunStatus } from './run-state-machine'
import {
  createInitialProjectAgentRunFence,
  createProjectAgentRunFence,
  type ProjectAgentRunFence,
} from './run-fence'
import type {
  DeclinedProjectAgentInterruption,
  ProjectAgentInterruptionType,
} from './interruptions'
import {
  createProjectAgentExecutionSegment,
  projectAgentExecutionStartedIdempotencyKey,
} from './execution-segment'
import { recoverProjectAgentPreparedExecutionHandoff } from './execution-handoff'

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
  runVersion: number
  eventSeq: string
  terminalEventSeq: string | null
  controlKind: ProjectAgentRunControlKind
  stopReason?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  heartbeatAt: Date | null
}

export const PROJECT_AGENT_RUN_HEARTBEAT_INTERVAL_MS = 30 * 1000
export const PROJECT_AGENT_RUN_STALE_MS = 90 * 1000

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

function normalizeControlKind(value: string): ProjectAgentRunControlKind {
  if (
    value === 'user_turn'
    || value === 'approval_response'
    || value === 'choice_response'
    || value === 'task_follow_up'
  ) return value
  throw new Error(`PROJECT_AGENT_RUN_CONTROL_KIND_INVALID:${value}`)
}

function toProjectAgentRunRecord(run: {
  id: string
  projectId: string
  userId: string
  assistantId: string
  scopeRef: string
  episodeId: string | null
  requestId: string
  status: string
  runVersion: number
  eventSeq: bigint
  terminalEventSeq: bigint | null
  controlKind: string
  stopReason?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  heartbeatAt: Date | null
}): ProjectAgentRunRecord {
  return {
    ...run,
    eventSeq: run.eventSeq.toString(),
    terminalEventSeq: run.terminalEventSeq?.toString() ?? null,
    status: normalizeProjectAgentRunStatus(run.status),
    controlKind: normalizeControlKind(run.controlKind),
  }
}

function staleHeartbeatCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - PROJECT_AGENT_RUN_STALE_MS)
}

async function getProjectAgentRunInTransaction(
  tx: ProjectAgentEventTransactionClient,
  params: ProjectAgentRunScope & {
    runId: string
  },
): Promise<ProjectAgentRunRecord | null> {
  const { assistantId, scopeRef } = buildRunScope(params)
  const run = await tx.projectAgentRun.findFirst({
    where: {
      id: params.runId,
      projectId: params.projectId,
      userId: params.userId,
      assistantId,
      scopeRef,
    },
    select: projectAgentRunRecordSelect,
  })
  return run ? toProjectAgentRunRecord(run) : null
}

const projectAgentRunRecordSelect = {
  id: true,
  projectId: true,
  userId: true,
  assistantId: true,
  scopeRef: true,
  episodeId: true,
  requestId: true,
  status: true,
  runVersion: true,
  eventSeq: true,
  terminalEventSeq: true,
  controlKind: true,
  stopReason: true,
  errorCode: true,
  errorMessage: true,
  heartbeatAt: true,
} satisfies Prisma.ProjectAgentRunSelect

export async function createProjectAgentRun(params: ProjectAgentRunScope & {
  requestId: string
  controlKind: ProjectAgentRunControlKind
  runId?: string
  appendMessages?: UIMessage[]
}): Promise<ProjectAgentRunRecord> {
  const runId = params.runId?.trim() || randomUUID()
  const runFence = createInitialProjectAgentRunFence(runId)
  const appendMessages = params.appendMessages ?? []
  if (appendMessages.length > 0) {
    const run = await prisma.$transaction(async (tx) => {
      await appendProjectAssistantThreadMessagesInTransaction(tx, {
        projectId: params.projectId,
        userId: params.userId,
        episodeId: params.episodeId ?? null,
        assistantId: params.assistantId ?? 'workspace-command',
        messages: appendMessages,
      })
      await appendProjectAgentEventsInTransaction(tx, {
        scope: {
          projectId: params.projectId,
          userId: params.userId,
          episodeId: params.episodeId ?? null,
          assistantId: params.assistantId ?? 'workspace-command',
          scopeRef: buildProjectAssistantScopeRef({
            projectId: params.projectId,
            episodeId: params.episodeId ?? null,
          }),
        },
        events: [{
          runFence,
          idempotencyKey: `run-started:${runId}`,
          event: {
            kind: 'run.started',
            runId,
            requestId: params.requestId,
            controlKind: params.controlKind,
          },
        }],
      })
      return await getProjectAgentRunInTransaction(tx, {
        ...params,
        runId,
      })
    })
    if (!run) throw new Error(`PROJECT_AGENT_RUN_CREATE_FAILED:${runId}`)
    return run
  }
  await appendProjectAgentEvents({
    scope: params,
    events: [{
      runFence,
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

type LockedConsumedInterruption = {
  id: string
  runId: string | null
  type: string
  status: string
}

export async function createProjectAgentConsumedControlRetryRun(
  params: ProjectAgentRunScope & {
    interruptionId: string
    requestId: string
    controlKind: 'approval_response' | 'choice_response'
    runId?: string
  },
): Promise<ProjectAgentRunRecord> {
  const assistantId = params.assistantId ?? 'workspace-command'
  const scopeRef = buildProjectAssistantScopeRef({
    projectId: params.projectId,
    episodeId: params.episodeId ?? null,
  })
  return await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<LockedConsumedInterruption[]>(Prisma.sql`
      SELECT id, runId, type, status
      FROM project_agent_interruptions
      WHERE id = ${params.interruptionId}
        AND projectId = ${params.projectId}
        AND userId = ${params.userId}
        AND assistantId = ${assistantId}
        AND scopeRef = ${scopeRef}
      FOR UPDATE
    `)
    const interruption = locked[0] ?? null
    const expectedType = params.controlKind === 'approval_response' ? 'approval' : 'choice'
    if (
      !interruption?.runId
      || interruption.type !== expectedType
      || interruption.status !== 'consumed'
    ) {
      throw new Error(`PROJECT_AGENT_CONSUMED_CONTROL_RETRY_INVALID:${params.interruptionId}`)
    }

    const retryRequestPrefix = `project-agent-control-retry:${params.interruptionId}:`
    const attempts = await tx.projectAgentRun.findMany({
      where: {
        projectId: params.projectId,
        userId: params.userId,
        assistantId,
        scopeRef,
        requestId: { startsWith: retryRequestPrefix },
      },
      orderBy: { createdAt: 'desc' },
      select: projectAgentRunRecordSelect,
    })
    const source = attempts[0] ?? await tx.projectAgentRun.findUnique({
      where: { id: interruption.runId },
      select: projectAgentRunRecordSelect,
    })
    if (!source) throw new Error(`PROJECT_AGENT_CONTROL_RETRY_SOURCE_RUN_MISSING:${interruption.runId}`)
    const sourceIsOriginalRun = source.id === interruption.runId
    if (
      source.projectId !== params.projectId
      || source.userId !== params.userId
      || source.assistantId !== assistantId
      || source.scopeRef !== scopeRef
      || (!sourceIsOriginalRun && source.controlKind !== params.controlKind)
    ) {
      throw new Error(`PROJECT_AGENT_CONTROL_RETRY_SOURCE_RUN_MISMATCH:${source.id}`)
    }
    const decisionSegment = createProjectAgentExecutionSegment({
      kind: params.controlKind,
      interruptionId: interruption.id,
    })
    const executionStarted = await tx.projectAgentEvent.findUnique({
      where: {
        idempotencyKey: projectAgentExecutionStartedIdempotencyKey(decisionSegment.id),
      },
      select: { id: true },
    })
    if (executionStarted) {
      throw new Error(`PROJECT_AGENT_CONTROL_EXECUTION_OUTCOME_UNKNOWN:${source.id}`)
    }
    const retryableBootstrapFailure = source.status === 'failed'
      && source.errorCode === 'PROJECT_AGENT_CONTROL_FAILED'
    const retryablePreExecutionCrash = source.status === 'cancelled'
      && source.stopReason === 'stale_running_run'
    if (!retryableBootstrapFailure && !retryablePreExecutionCrash) {
      throw new Error(`PROJECT_AGENT_CONTROL_RETRY_NOT_ALLOWED:${source.id}:${source.status}`)
    }

    const runId = params.runId?.trim() || randomUUID()
    const runFence = createInitialProjectAgentRunFence(runId)
    const attempt = attempts.length + 1
    await appendProjectAgentEventsInTransaction(tx, {
      scope: {
        projectId: params.projectId,
        userId: params.userId,
        episodeId: params.episodeId ?? null,
        assistantId,
        scopeRef,
      },
      events: [{
        runFence,
        idempotencyKey: `run-started:${runId}`,
        event: {
          kind: 'run.started',
          runId,
          requestId: `${retryRequestPrefix}${attempt}:${params.requestId}`,
          controlKind: params.controlKind,
        },
      }],
    })
    const run = await getProjectAgentRunInTransaction(tx, {
      ...params,
      assistantId,
      runId,
    })
    if (!run) throw new Error(`PROJECT_AGENT_RUN_CREATE_FAILED:${runId}`)
    return run
  })
}

type PendingRunForUserTurn = {
  id: string
  status: string
  runVersion: number
  eventSeq: bigint
}

type PendingInterruptionForUserTurn = {
  id: string
  approvalId: string
  runId: string | null
  activityId: string | null
  type: string
  operationId: string
}

/**
 * Starts a fresh user turn and retires the previous waiting turn as one scope
 * transaction. The user's message, the immutable rejection/supersede decision,
 * Run/Activity/Wait cancellation, and the new Run therefore cannot be observed
 * as a half-applied handoff.
 */
export async function createProjectAgentUserTurnRun(params: ProjectAgentRunScope & {
  runId?: string
  requestId: string
  message: UIMessage
}): Promise<{
  run: ProjectAgentRunRecord
  declinedInterruptions: DeclinedProjectAgentInterruption[]
}> {
  const runId = params.runId?.trim() || randomUUID()
  const assistantId = params.assistantId ?? 'workspace-command'
  const scopeRef = buildProjectAssistantScopeRef({
    projectId: params.projectId,
    episodeId: params.episodeId ?? null,
  })
  return await prisma.$transaction(async (tx) => {
    const pendingRuns = await tx.$queryRaw<PendingRunForUserTurn[]>(Prisma.sql`
      SELECT id, status, runVersion, eventSeq
      FROM project_agent_runs
      WHERE projectId = ${params.projectId}
        AND userId = ${params.userId}
        AND assistantId = ${assistantId}
        AND scopeRef = ${scopeRef}
        AND status IN ('awaiting_approval', 'awaiting_choice')
      ORDER BY createdAt ASC
      FOR UPDATE
    `)
    const pendingRunIds = pendingRuns.map((run) => run.id)
    const pendingInterruptions = pendingRunIds.length > 0
      ? await tx.projectAgentInterruption.findMany({
          where: {
            runId: { in: pendingRunIds },
            status: 'pending',
          },
          select: {
            id: true,
            approvalId: true,
            runId: true,
            activityId: true,
            type: true,
            operationId: true,
          },
          orderBy: { createdAt: 'asc' },
        })
      : []
    const interruptionsByRun = new Map<string, PendingInterruptionForUserTurn[]>()
    for (const interruption of pendingInterruptions) {
      if (!interruption.runId) throw new Error(`PROJECT_AGENT_PENDING_INTERRUPTION_RUN_ID_MISSING:${interruption.id}`)
      const existing = interruptionsByRun.get(interruption.runId) ?? []
      existing.push(interruption)
      interruptionsByRun.set(interruption.runId, existing)
    }
    for (const [pendingRunId, interruptions] of interruptionsByRun) {
      if (interruptions.length > 1) {
        throw new Error(`PROJECT_AGENT_MULTIPLE_PENDING_INTERRUPTS_FOR_RUN:${pendingRunId}`)
      }
    }

    const retirementEvents: ProjectAgentEventInput[] = pendingRuns.flatMap((pendingRun): ProjectAgentEventInput[] => {
      const runFence = createProjectAgentRunFence(pendingRun)
      const interruption = interruptionsByRun.get(pendingRun.id)?.[0] ?? null
      const events: ProjectAgentEventInput[] = []
      if (interruption) {
        const isApproval = interruption.type === 'approval'
        events.push({
          runFence,
          idempotencyKey: `interruption-resolved:${interruption.id}:${isApproval ? 'consumed' : 'superseded'}`,
          event: {
            kind: 'interruption.resolved' as const,
            runId: pendingRun.id,
            activityId: interruption.activityId,
            interruptionId: interruption.id,
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
        })
      }
      events.push({
        runFence,
        idempotencyKey: `run-superseded:${pendingRun.id}:${runId}`,
        event: {
          kind: 'run.status_changed' as const,
          runId: pendingRun.id,
          status: 'cancelled' as const,
          expectedStatuses: interruption
            ? ['running']
            : [normalizeProjectAgentRunStatus(pendingRun.status)],
          stopReason: 'superseded',
          errorCode: null,
          errorMessage: null,
        },
      })
      return events
    })
    if (retirementEvents.length > 0) {
      await appendProjectAgentEventsInTransaction(tx, {
        scope: {
          projectId: params.projectId,
          userId: params.userId,
          episodeId: params.episodeId ?? null,
          assistantId,
          scopeRef,
        },
        events: retirementEvents,
      })
    }

    await appendProjectAssistantThreadMessagesInTransaction(tx, {
      projectId: params.projectId,
      userId: params.userId,
      episodeId: params.episodeId ?? null,
      assistantId,
      messages: [params.message],
    })
    const runFence = createInitialProjectAgentRunFence(runId)
    await appendProjectAgentEventsInTransaction(tx, {
      scope: {
        projectId: params.projectId,
        userId: params.userId,
        episodeId: params.episodeId ?? null,
        assistantId,
        scopeRef,
      },
      events: [{
        runFence,
        idempotencyKey: `run-started:${runId}`,
        event: {
          kind: 'run.started',
          runId,
          requestId: params.requestId,
          controlKind: 'user_turn',
        },
      }],
    })
    const run = await getProjectAgentRunInTransaction(tx, { ...params, runId })
    if (!run) throw new Error(`PROJECT_AGENT_RUN_CREATE_FAILED:${runId}`)
    return {
      run,
      declinedInterruptions: pendingInterruptions.map((interruption) => ({
        id: interruption.id,
        approvalId: interruption.approvalId,
        runId: interruption.runId,
        activityId: interruption.activityId,
        type: interruption.type as ProjectAgentInterruptionType,
        operationId: interruption.operationId,
      })),
    }
  })
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
    select: projectAgentRunRecordSelect,
  })
  if (!run) return null
  return toProjectAgentRunRecord(run)
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
    select: projectAgentRunRecordSelect,
  })
  return runs.map((run) => toProjectAgentRunRecord(run))
}

export async function updateProjectAgentRunStatus(params: {
  runFence: ProjectAgentRunFence
  status: ProjectAgentRunStatus
  expectedStatuses?: readonly ProjectAgentRunStatus[]
  stopReason?: string | null
  errorCode?: string | null
  errorMessage?: string | null
}): Promise<void> {
  const run = await prisma.projectAgentRun.findUnique({
    where: { id: params.runFence.runId },
    select: {
      projectId: true,
      userId: true,
      episodeId: true,
      assistantId: true,
    },
  })
  if (!run) throw new Error(`PROJECT_AGENT_RUN_NOT_FOUND:${params.runFence.runId}`)
  await appendProjectAgentEvents({
    scope: {
      projectId: run.projectId,
      userId: run.userId,
      episodeId: run.episodeId,
      assistantId: run.assistantId as ProjectAssistantId,
    },
    events: [{
      runFence: params.runFence,
      event: {
        kind: 'run.status_changed',
        runId: params.runFence.runId,
        status: params.status,
        expectedStatuses: params.expectedStatuses ? [...params.expectedStatuses] : undefined,
        stopReason: params.stopReason,
        errorCode: params.errorCode,
        errorMessage: params.errorMessage,
      },
    }],
  })
}

export async function settleProjectAgentRunWithMessage(params: {
  runFence: ProjectAgentRunFence
  status: ProjectAgentRunStatus
  expectedStatuses?: readonly ProjectAgentRunStatus[]
  stopReason?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  message: UIMessage
  modelHistoryCommit?: ProjectAssistantModelHistoryCommit
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const run = await tx.projectAgentRun.findUnique({
      where: { id: params.runFence.runId },
      select: {
        projectId: true,
        userId: true,
        episodeId: true,
        assistantId: true,
      },
    })
    if (!run) throw new Error(`PROJECT_AGENT_RUN_NOT_FOUND:${params.runFence.runId}`)
    await appendProjectAssistantThreadMessagesInTransaction(tx, {
      projectId: run.projectId,
      userId: run.userId,
      episodeId: run.episodeId,
      assistantId: run.assistantId as ProjectAssistantId,
      messages: [params.message],
      ...(params.modelHistoryCommit ? { modelHistoryCommit: params.modelHistoryCommit } : {}),
    })
    await appendProjectAgentEventsInTransaction(tx, {
      scope: {
        projectId: run.projectId,
        userId: run.userId,
        episodeId: run.episodeId,
        assistantId: run.assistantId as ProjectAssistantId,
        scopeRef: buildProjectAssistantScopeRef({
          projectId: run.projectId,
          episodeId: run.episodeId,
        }),
      },
      events: [{
        runFence: params.runFence,
        idempotencyKey: `run-message-settlement:${params.runFence.runId}:${params.message.id}`,
        event: {
          kind: 'run.status_changed',
          runId: params.runFence.runId,
          status: params.status,
          expectedStatuses: params.expectedStatuses ? [...params.expectedStatuses] : undefined,
          stopReason: params.stopReason,
          errorCode: params.errorCode,
          errorMessage: params.errorMessage,
        },
      }],
    })
  })
}

export async function settleProjectAgentRunFailureWithMessage(params: {
  runFence: ProjectAgentRunFence
  controlKind: ProjectAgentRunControlKind
  requestId: string
  status: 'failed' | 'cancelled'
  stopReason: string
  errorCode?: string | null
  errorMessage?: string | null
  modelHistoryCommit?: ProjectAssistantModelHistoryCommit
}): Promise<void> {
  const message: UIMessage = {
    id: `workspace-assistant-run:${params.controlKind}:${params.runFence.runId}:${params.requestId}`,
    role: 'assistant',
    metadata: {
      custom: {
        projectAgentRunId: params.runFence.runId,
      },
    },
    parts: [{
      type: 'data-agent-run',
      data: {
        runId: params.runFence.runId,
        requestId: params.requestId,
        status: params.status,
        controlKind: params.controlKind,
        stopReason: params.stopReason,
      },
    }],
  }
  await settleProjectAgentRunWithMessage({
    runFence: params.runFence,
    status: params.status,
    expectedStatuses: ['running'],
    stopReason: params.stopReason,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
    message,
    ...(params.modelHistoryCommit ? { modelHistoryCommit: params.modelHistoryCommit } : {}),
  })
}

export async function cancelRunningProjectAgentRun(params: {
  runFence: ProjectAgentRunFence
  stopReason: string
  errorCode?: string | null
  errorMessage?: string | null
}): Promise<boolean> {
  const run = await prisma.projectAgentRun.findFirst({
    where: {
      id: params.runFence.runId,
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
      runFence: params.runFence,
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

export async function touchProjectAgentRunHeartbeat(params: {
  runId: string
  now?: Date
}): Promise<boolean> {
  const updated = await prisma.projectAgentRun.updateMany({
    where: {
      id: params.runId,
      status: 'running',
    },
    data: {
      heartbeatAt: params.now ?? new Date(),
    },
  })
  return updated.count > 0
}

export async function findFreshRunningProjectAgentRunForScope(
  scope: ProjectAgentRunScope & { excludeRunId?: string | null },
  now: Date = new Date(),
): Promise<ProjectAgentRunRecord | null> {
  const { assistantId, scopeRef } = buildRunScope(scope)
  const run = await prisma.projectAgentRun.findFirst({
    where: {
      projectId: scope.projectId,
      userId: scope.userId,
      assistantId,
      scopeRef,
      status: 'running',
      ...(scope.excludeRunId ? { id: { not: scope.excludeRunId } } : {}),
      heartbeatAt: {
        gte: staleHeartbeatCutoff(now),
      },
    },
    orderBy: { heartbeatAt: 'desc' },
    select: projectAgentRunRecordSelect,
  })
  return run ? toProjectAgentRunRecord(run) : null
}

export async function cancelStaleRunningProjectAgentRunsForScope(
  scope: ProjectAgentRunScope & { excludeRunId?: string | null },
  now: Date = new Date(),
): Promise<string[]> {
  const { assistantId, scopeRef } = buildRunScope(scope)
  const staleRuns = await prisma.projectAgentRun.findMany({
    where: {
      projectId: scope.projectId,
      userId: scope.userId,
      assistantId,
      scopeRef,
      status: 'running',
      ...(scope.excludeRunId ? { id: { not: scope.excludeRunId } } : {}),
      OR: [
        { heartbeatAt: null },
        {
          heartbeatAt: {
            lt: staleHeartbeatCutoff(now),
          },
        },
      ],
    },
    select: { id: true, runVersion: true, eventSeq: true },
  })
  const settled = await Promise.all(staleRuns.map(async (run) => {
    const recovered = await recoverProjectAgentPreparedExecutionHandoff({
      executionFence: {
        runFence: createProjectAgentRunFence(run),
        signal: new AbortController().signal,
      },
      projectId: scope.projectId,
      userId: scope.userId,
      episodeId: scope.episodeId ?? null,
      assistantId,
    })
    if (!recovered || recovered === 'task_batch') {
      await prisma.$transaction(async (tx) => {
        const executionEvents = await tx.projectAgentEvent.findMany({
          where: {
            runId: run.id,
            kind: 'run.execution_started',
          },
          select: { payload: true },
        })
        const executionSegmentIds = executionEvents.flatMap(({ payload }) => {
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
          const executionSegmentId = (payload as Record<string, unknown>).executionSegmentId
          return typeof executionSegmentId === 'string' && executionSegmentId.trim()
            ? [executionSegmentId]
            : []
        })
        await discardProjectAssistantPendingModelHistoryInTransaction(tx, {
          projectId: scope.projectId,
          userId: scope.userId,
          episodeId: scope.episodeId ?? null,
          assistantId,
          executionSegmentIds,
        })
        await appendProjectAgentEventsInTransaction(tx, {
          scope: {
            projectId: scope.projectId,
            userId: scope.userId,
            episodeId: scope.episodeId ?? null,
            assistantId,
            scopeRef,
          },
          events: [{
            runFence: createProjectAgentRunFence(run),
            event: {
              kind: 'run.status_changed',
              runId: run.id,
              status: 'cancelled',
              expectedStatuses: ['running'],
              stopReason: 'stale_running_run',
            },
          }],
        })
      })
    }
    await releaseProjectAgentRunLockForRun({
      ...scope,
      runId: run.id,
    }).catch((error: unknown) => {
      projectAgentRunLogger.warn({
        action: 'assistant.run-lock.stale-release.failed',
        message: 'Failed to release stale project agent run lock',
        details: {
          runId: run.id,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    })
    return recovered && recovered !== 'task_batch' ? null : run.id
  }))
  return settled.filter((runId): runId is string => runId !== null)
}

export async function ensureProjectAgentRunSlotAvailable(
  scope: ProjectAgentRunScope & { excludeRunId?: string | null },
): Promise<void> {
  await cancelStaleRunningProjectAgentRunsForScope(scope)
  const freshRun = await findFreshRunningProjectAgentRunForScope(scope)
  if (freshRun) {
    throw new Error('PROJECT_AGENT_RUN_ACTIVE')
  }
}

export async function hasPendingProjectAgentDecisionRunForScope(
  scope: ProjectAgentRunScope & { excludeRunId?: string | null },
): Promise<boolean> {
  const { assistantId, scopeRef } = buildRunScope(scope)
  const run = await prisma.projectAgentRun.findFirst({
    where: {
      projectId: scope.projectId,
      userId: scope.userId,
      assistantId,
      scopeRef,
      status: { in: ['awaiting_approval', 'awaiting_choice'] },
      ...(scope.excludeRunId ? { id: { not: scope.excludeRunId } } : {}),
    },
    select: { id: true },
  })
  return Boolean(run)
}
