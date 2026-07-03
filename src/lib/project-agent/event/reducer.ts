import { Prisma } from '@prisma/client'
import type { ProjectAgentRunStatus } from '../runs'
import {
  type ProjectAgentActivitySnapshot,
  type ProjectAgentActivityStatus,
  type ProjectAgentActivityType,
  type ProjectAgentEventPayload,
  type ProjectAgentEventScopeRef,
  normalizeProjectAgentActivityStatus,
  normalizeProjectAgentActivityType,
} from './types'

type ProjectAgentProjectionTx = Prisma.TransactionClient

const OPEN_ACTIVITY_STATUSES: ProjectAgentActivityStatus[] = ['running', 'waiting']

function runStatusForActivityType(type: ProjectAgentActivityType): ProjectAgentRunStatus {
  if (type === 'waiting_task') return 'awaiting_task'
  if (type === 'awaiting_choice') return 'awaiting_choice'
  if (type === 'awaiting_approval') return 'awaiting_approval'
  return 'running'
}

function now(): Date {
  return new Date()
}

function activityStatusForType(type: ProjectAgentActivityType): ProjectAgentActivityStatus {
  return type === 'waiting_task' || type === 'awaiting_choice' || type === 'awaiting_approval'
    ? 'waiting'
    : 'running'
}

function toActivitySnapshot(record: {
  id: string
  runId: string
  type: string
  status: string
  operationId: string | null
  sourceOperationId: string | null
  toolCallId: string | null
  choiceType: string | null
}): ProjectAgentActivitySnapshot {
  const choiceType = record.choiceType
  if (
    choiceType !== null
    && choiceType !== 'duration_and_aspect_ratio'
    && choiceType !== 'screenplay_review'
    && choiceType !== 'style'
    && choiceType !== 'asset_review'
  ) {
    throw new Error(`PROJECT_AGENT_ACTIVITY_CHOICE_TYPE_INVALID:${choiceType}`)
  }
  return {
    activityId: record.id,
    runId: record.runId,
    type: normalizeProjectAgentActivityType(record.type),
    status: normalizeProjectAgentActivityStatus(record.status),
    operationId: record.operationId,
    sourceOperationId: record.sourceOperationId,
    toolCallId: record.toolCallId,
    choiceType,
  }
}

async function getActivitySnapshot(
  tx: ProjectAgentProjectionTx,
  activityId: string | null | undefined,
): Promise<ProjectAgentActivitySnapshot | null> {
  if (!activityId) return null
  const record = await tx.projectAgentActivity.findUnique({
    where: { id: activityId },
    select: {
      id: true,
      runId: true,
      type: true,
      status: true,
      operationId: true,
      sourceOperationId: true,
      toolCallId: true,
      choiceType: true,
    },
  })
  return record ? toActivitySnapshot(record) : null
}

async function assertRunHasNoOpenActivity(
  tx: ProjectAgentProjectionTx,
  runId: string,
  activityId: string,
): Promise<void> {
  const existing = await tx.projectAgentActivity.findFirst({
    where: {
      runId,
      status: { in: OPEN_ACTIVITY_STATUSES },
      id: { not: activityId },
    },
    select: {
      id: true,
      type: true,
      status: true,
    },
    orderBy: { createdAt: 'desc' },
  })
  if (existing) {
    throw new Error(`PROJECT_AGENT_ACTIVITY_OVERLAP runId=${runId} activeActivityId=${existing.id} activeType=${existing.type}`)
  }
}

async function cancelOpenActivitiesForRun(
  tx: ProjectAgentProjectionTx,
  runId: string,
  reason: string,
): Promise<void> {
  await tx.projectAgentActivity.updateMany({
    where: {
      runId,
      status: { in: OPEN_ACTIVITY_STATUSES },
    },
    data: {
      status: 'cancelled',
      errorCode: 'PROJECT_AGENT_RUN_CANCELLED',
      errorMessage: reason,
      cancelledAt: now(),
    },
  })
}

async function markRunStatus(
  tx: ProjectAgentProjectionTx,
  params: {
    runId: string
    status: ProjectAgentRunStatus
    stopReason?: string | null
    errorCode?: string | null
    errorMessage?: string | null
  },
): Promise<void> {
  const timestamp = now()
  await tx.projectAgentRun.updateMany({
    where: { id: params.runId },
    data: {
      status: params.status,
      stopReason: params.stopReason ?? null,
      errorCode: params.errorCode ?? null,
      errorMessage: params.errorMessage ?? null,
      ...(params.status === 'completed' ? { completedAt: timestamp } : {}),
      ...(params.status === 'failed' ? { failedAt: timestamp } : {}),
      ...(params.status === 'cancelled' ? { cancelledAt: timestamp } : {}),
      ...(params.status === 'running' ? { heartbeatAt: timestamp } : {}),
    },
  })
}

async function applyRunStarted(
  tx: ProjectAgentProjectionTx,
  scope: ProjectAgentEventScopeRef,
  event: Extract<ProjectAgentEventPayload, { kind: 'run.started' }>,
): Promise<void> {
  const timestamp = now()
  await tx.projectAgentRun.upsert({
    where: { id: event.runId },
    create: {
      id: event.runId,
      projectId: scope.projectId,
      userId: scope.userId,
      assistantId: scope.assistantId,
      scopeRef: scope.scopeRef,
      episodeId: scope.episodeId,
      requestId: event.requestId,
      status: 'running',
      controlKind: event.controlKind,
      heartbeatAt: timestamp,
    },
    update: {
      requestId: event.requestId,
      status: 'running',
      controlKind: event.controlKind,
      heartbeatAt: timestamp,
      stopReason: null,
      errorCode: null,
      errorMessage: null,
      completedAt: null,
      failedAt: null,
      cancelledAt: null,
    },
  })
}

async function applyActivityStarted(
  tx: ProjectAgentProjectionTx,
  scope: ProjectAgentEventScopeRef,
  event: Extract<ProjectAgentEventPayload, { kind: 'activity.started' }>,
): Promise<ProjectAgentActivitySnapshot | null> {
  await assertRunHasNoOpenActivity(tx, event.runId, event.activityId)
  const type = event.type
  const status = activityStatusForType(type)
  await tx.projectAgentActivity.upsert({
    where: { id: event.activityId },
    create: {
      id: event.activityId,
      runId: event.runId,
      projectId: scope.projectId,
      userId: scope.userId,
      assistantId: scope.assistantId,
      scopeRef: scope.scopeRef,
      episodeId: scope.episodeId,
      type,
      status,
      operationId: event.operationId ?? null,
      sourceOperationId: event.sourceOperationId ?? null,
      toolCallId: event.toolCallId ?? null,
      choiceType: event.choiceType ?? null,
    },
    update: {
      type,
      status,
      operationId: event.operationId ?? null,
      sourceOperationId: event.sourceOperationId ?? null,
      toolCallId: event.toolCallId ?? null,
      choiceType: event.choiceType ?? null,
      completedAt: null,
      failedAt: null,
      cancelledAt: null,
      errorCode: null,
      errorMessage: null,
    },
  })
  await markRunStatus(tx, {
    runId: event.runId,
    status: runStatusForActivityType(type),
    stopReason: type,
  })
  return getActivitySnapshot(tx, event.activityId)
}

async function completeActivity(
  tx: ProjectAgentProjectionTx,
  event: Extract<ProjectAgentEventPayload, { kind: 'activity.completed' }>,
): Promise<ProjectAgentActivitySnapshot | null> {
  await tx.projectAgentActivity.updateMany({
    where: {
      id: event.activityId,
      runId: event.runId,
      status: { in: OPEN_ACTIVITY_STATUSES },
    },
    data: {
      status: 'completed',
      completedAt: now(),
    },
  })
  return getActivitySnapshot(tx, event.activityId)
}

async function failActivity(
  tx: ProjectAgentProjectionTx,
  event: Extract<ProjectAgentEventPayload, { kind: 'activity.failed' }>,
): Promise<ProjectAgentActivitySnapshot | null> {
  await tx.projectAgentActivity.updateMany({
    where: {
      id: event.activityId,
      runId: event.runId,
      status: { in: OPEN_ACTIVITY_STATUSES },
    },
    data: {
      status: 'failed',
      errorCode: event.errorCode,
      errorMessage: event.errorMessage,
      failedAt: now(),
    },
  })
  return getActivitySnapshot(tx, event.activityId)
}

async function cancelActivity(
  tx: ProjectAgentProjectionTx,
  event: Extract<ProjectAgentEventPayload, { kind: 'activity.cancelled' }>,
): Promise<ProjectAgentActivitySnapshot | null> {
  await tx.projectAgentActivity.updateMany({
    where: {
      id: event.activityId,
      runId: event.runId,
      status: { in: OPEN_ACTIVITY_STATUSES },
    },
    data: {
      status: 'cancelled',
      errorCode: 'PROJECT_AGENT_ACTIVITY_CANCELLED',
      errorMessage: event.reason,
      cancelledAt: now(),
    },
  })
  return getActivitySnapshot(tx, event.activityId)
}

async function applyTaskBound(
  tx: ProjectAgentProjectionTx,
  scope: ProjectAgentEventScopeRef,
  event: Extract<ProjectAgentEventPayload, { kind: 'task.bound' }>,
): Promise<ProjectAgentActivitySnapshot | null> {
  await tx.projectAgentWait.upsert({
    where: { id: event.waitId },
    create: {
      id: event.waitId,
      runId: event.runId,
      activityId: event.activityId,
      projectId: scope.projectId,
      userId: scope.userId,
      assistantId: scope.assistantId,
      scopeRef: scope.scopeRef,
      episodeId: scope.episodeId,
      operationId: event.operationId,
      taskIds: event.taskIds,
      followUpMode: event.followUpMode,
      status: 'pending',
    },
    update: {
      activityId: event.activityId,
      operationId: event.operationId,
      taskIds: event.taskIds,
      followUpMode: event.followUpMode,
      status: 'pending',
      terminalStatus: null,
      terminalTaskIds: [],
      failedTaskIds: [],
      followUpKey: null,
      claimId: null,
      claimedAt: null,
      claimExpiresAt: null,
      followedAt: null,
      resolvedAt: null,
    },
  })
  return getActivitySnapshot(tx, event.activityId)
}

async function applyTaskProgressed(
  tx: ProjectAgentProjectionTx,
  event: Extract<ProjectAgentEventPayload, { kind: 'task.progressed' }>,
): Promise<ProjectAgentActivitySnapshot | null> {
  await tx.projectAgentWait.updateMany({
    where: {
      id: event.waitId,
      activityId: event.activityId,
      status: 'pending',
    },
    data: {
      terminalTaskIds: event.terminalTaskIds,
      failedTaskIds: event.failedTaskIds,
    },
  })
  return getActivitySnapshot(tx, event.activityId)
}

async function applyTaskTerminal(
  tx: ProjectAgentProjectionTx,
  scope: ProjectAgentEventScopeRef,
  event: Extract<ProjectAgentEventPayload, { kind: 'task.terminal' }>,
): Promise<ProjectAgentActivitySnapshot | null> {
  const wait = await tx.projectAgentWait.findUnique({
    where: { id: event.waitId },
    select: {
      id: true,
      runId: true,
      operationId: true,
      followUpMode: true,
    },
  })
  if (!wait) throw new Error(`PROJECT_AGENT_WAIT_NOT_FOUND waitId=${event.waitId}`)
  const nextStatus = (
    (wait.followUpMode === 'await_user_choice' || wait.followUpMode === 'complete')
    && event.terminalStatus === 'completed'
  ) ? 'followed' : 'resolved'
  await tx.projectAgentWait.updateMany({
    where: {
      id: event.waitId,
      activityId: event.activityId,
      status: 'pending',
    },
    data: {
      status: nextStatus,
      terminalStatus: event.terminalStatus,
      terminalTaskIds: event.terminalTaskIds,
      failedTaskIds: event.failedTaskIds,
      followUpKey: `project-agent-wait:${event.waitId}:${event.terminalStatus}`,
      followedAt: nextStatus === 'followed' ? now() : null,
      resolvedAt: now(),
    },
  })
  await tx.projectAgentActivity.updateMany({
    where: {
      id: event.activityId,
      status: { in: OPEN_ACTIVITY_STATUSES },
    },
    data: {
      status: event.terminalStatus === 'completed' ? 'completed' : 'failed',
      completedAt: event.terminalStatus === 'completed' ? now() : null,
      failedAt: event.terminalStatus === 'failed' ? now() : null,
      errorCode: event.terminalStatus === 'failed' ? 'PROJECT_AGENT_TASK_FAILED' : null,
      errorMessage: event.terminalStatus === 'failed' ? 'Project agent task wait failed' : null,
    },
  })
  if (event.terminalStatus === 'completed' && wait.runId) {
    if (wait.followUpMode === 'complete') {
      await markRunStatus(tx, {
        runId: wait.runId,
        status: 'completed',
        stopReason: 'task_completed',
      })
    } else if (wait.followUpMode === 'await_user_choice' && event.nextActivityId) {
      await applyActivityStarted(tx, scope, {
        kind: 'activity.started',
        runId: wait.runId,
        activityId: event.nextActivityId,
        type: 'awaiting_choice',
        operationId: null,
        sourceOperationId: wait.operationId,
        choiceType: 'style',
      })
    }
  }
  return getActivitySnapshot(tx, event.activityId)
}

async function applyWaitFollowed(
  tx: ProjectAgentProjectionTx,
  event: Extract<ProjectAgentEventPayload, { kind: 'wait.followed' }>,
): Promise<ProjectAgentActivitySnapshot | null> {
  await tx.projectAgentWait.updateMany({
    where: {
      id: event.waitId,
      runId: event.runId,
      status: 'claimed',
      claimId: event.claimId,
      followedAt: null,
    },
    data: {
      status: 'followed',
      followedAt: now(),
    },
  })
  return getActivitySnapshot(tx, event.activityId)
}

async function applyInterruptionRaised(
  tx: ProjectAgentProjectionTx,
  scope: ProjectAgentEventScopeRef,
  event: Extract<ProjectAgentEventPayload, { kind: 'interruption.raised' }>,
): Promise<ProjectAgentActivitySnapshot | null> {
  await applyActivityStarted(tx, scope, {
    kind: 'activity.started',
    runId: event.runId,
    activityId: event.activityId,
    type: event.interruptionKind === 'approval' ? 'awaiting_approval' : 'awaiting_choice',
    operationId: event.operationId,
    toolCallId: event.toolCallId ?? null,
    choiceType: event.choiceType ?? null,
  })
  await tx.projectAgentInterruption.create({
    data: {
      id: event.interruptionId,
      runId: event.runId,
      activityId: event.activityId,
      projectId: scope.projectId,
      userId: scope.userId,
      assistantId: scope.assistantId,
      scopeRef: scope.scopeRef,
      episodeId: scope.episodeId,
      type: event.interruptionKind,
      status: 'pending',
      operationId: event.operationId,
      approvalId: event.approvalId,
      toolCallId: event.toolCallId ?? null,
      payload: event.payload,
      runState: event.runState ?? null,
    },
  })
  return getActivitySnapshot(tx, event.activityId)
}

async function applyInterruptionResolved(
  tx: ProjectAgentProjectionTx,
  event: Extract<ProjectAgentEventPayload, { kind: 'interruption.resolved' }>,
): Promise<ProjectAgentActivitySnapshot | null> {
  await tx.projectAgentInterruption.updateMany({
    where: {
      id: event.interruptionId,
      runId: event.runId,
      status: 'pending',
    },
    data: {
      status: event.outcome,
      response: event.response ?? undefined,
      consumedAt: now(),
      runState: null,
    },
  })
  if (event.activityId) {
    await tx.projectAgentActivity.updateMany({
      where: {
        id: event.activityId,
        runId: event.runId,
        status: { in: OPEN_ACTIVITY_STATUSES },
      },
      data: {
        status: event.outcome === 'consumed' ? 'completed' : 'cancelled',
        completedAt: event.outcome === 'consumed' ? now() : null,
        cancelledAt: event.outcome === 'superseded' ? now() : null,
      },
    })
  }
  return getActivitySnapshot(tx, event.activityId)
}

async function applyInterruptionReopened(
  tx: ProjectAgentProjectionTx,
  event: Extract<ProjectAgentEventPayload, { kind: 'interruption.reopened' }>,
): Promise<ProjectAgentActivitySnapshot | null> {
  await tx.projectAgentInterruption.updateMany({
    where: {
      id: event.interruptionId,
      runId: event.runId,
      status: 'consumed',
    },
    data: {
      status: 'pending',
      response: Prisma.DbNull,
      consumedAt: null,
    },
  })
  if (event.activityId) {
    await tx.projectAgentActivity.updateMany({
      where: {
        id: event.activityId,
        runId: event.runId,
      },
      data: {
        status: 'waiting',
        completedAt: null,
        failedAt: null,
        cancelledAt: null,
        errorCode: null,
        errorMessage: null,
      },
    })
    await markRunStatus(tx, {
      runId: event.runId,
      status: 'awaiting_approval',
      stopReason: 'awaiting_approval',
    })
  }
  return getActivitySnapshot(tx, event.activityId)
}

export async function reduceProjectAgentEvent(params: {
  tx: ProjectAgentProjectionTx
  scope: ProjectAgentEventScopeRef
  event: ProjectAgentEventPayload
}): Promise<ProjectAgentActivitySnapshot | null> {
  const { tx, scope, event } = params
  switch (event.kind) {
    case 'run.started':
      await applyRunStarted(tx, scope, event)
      return null
    case 'run.status_changed':
      await markRunStatus(tx, {
        runId: event.runId,
        status: event.status,
        stopReason: event.stopReason,
        errorCode: event.errorCode,
        errorMessage: event.errorMessage,
      })
      if (event.status === 'failed' || event.status === 'cancelled') {
        await cancelOpenActivitiesForRun(tx, event.runId, event.errorMessage ?? event.stopReason ?? event.status)
      }
      return null
    case 'run.completed':
      await markRunStatus(tx, { runId: event.runId, status: 'completed', stopReason: event.stopReason ?? 'completed' })
      return null
    case 'run.failed':
      await markRunStatus(tx, {
        runId: event.runId,
        status: 'failed',
        stopReason: event.stopReason ?? 'failed',
        errorCode: event.errorCode,
        errorMessage: event.errorMessage,
      })
      await cancelOpenActivitiesForRun(tx, event.runId, event.errorMessage)
      return null
    case 'run.cancelled':
      await markRunStatus(tx, { runId: event.runId, status: 'cancelled', stopReason: event.reason })
      await cancelOpenActivitiesForRun(tx, event.runId, event.reason)
      return null
    case 'activity.started':
      return await applyActivityStarted(tx, scope, event)
    case 'activity.completed':
      return await completeActivity(tx, event)
    case 'activity.failed':
      return await failActivity(tx, event)
    case 'activity.cancelled':
      return await cancelActivity(tx, event)
    case 'task.bound':
      return await applyTaskBound(tx, scope, event)
    case 'task.progressed':
      return await applyTaskProgressed(tx, event)
    case 'task.terminal':
      return await applyTaskTerminal(tx, scope, event)
    case 'wait.followed':
      return await applyWaitFollowed(tx, event)
    case 'interruption.raised':
      return await applyInterruptionRaised(tx, scope, event)
    case 'interruption.resolved':
      return await applyInterruptionResolved(tx, event)
    case 'interruption.reopened':
      return await applyInterruptionReopened(tx, event)
  }
}
