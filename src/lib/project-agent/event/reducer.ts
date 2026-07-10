import { Prisma } from '@prisma/client'
import type { ProjectAgentRunStatus } from '../runs'
import {
  assertProjectAgentRunTransition,
  isProjectAgentRunTerminalStatus,
  normalizeProjectAgentRunStatus,
} from '../run-state-machine'
import {
  advanceProjectAgentRunFence,
  type ProjectAgentRunFence,
} from '../run-fence'
import { isEditFirstChoiceType } from '../edit-first-choice-tools'
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
  if (choiceType !== null && !isEditFirstChoiceType(choiceType)) {
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
    expectedFence: ProjectAgentRunFence
    status: ProjectAgentRunStatus
    expectedStatuses?: readonly ProjectAgentRunStatus[]
    stopReason?: string | null
    errorCode?: string | null
    errorMessage?: string | null
  },
): Promise<void> {
  const current = await tx.projectAgentRun.findUnique({
    where: { id: params.runId },
    select: { status: true, runVersion: true, eventSeq: true },
  })
  if (!current) throw new Error(`PROJECT_AGENT_RUN_NOT_FOUND:${params.runId}`)
  const currentStatus = normalizeProjectAgentRunStatus(current.status)
  if (
    current.runVersion !== params.expectedFence.runVersion
    || current.eventSeq.toString() !== params.expectedFence.eventSeq
  ) {
    throw new Error(`PROJECT_AGENT_RUN_EVENT_STALE runId=${params.runId} expectedVersion=${params.expectedFence.runVersion} actualVersion=${current.runVersion}`)
  }
  assertProjectAgentRunTransition({
    runId: params.runId,
    from: currentStatus,
    to: params.status,
    expectedStatuses: params.expectedStatuses,
  })
  const timestamp = now()
  const updated = await tx.projectAgentRun.updateMany({
    where: {
      id: params.runId,
      status: currentStatus,
      runVersion: params.expectedFence.runVersion,
      eventSeq: BigInt(params.expectedFence.eventSeq),
    },
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
  if (updated.count !== 1) {
    throw new Error(`PROJECT_AGENT_RUN_TRANSITION_RACED runId=${params.runId} from=${currentStatus} to=${params.status}`)
  }
}

async function applyRunStarted(
  tx: ProjectAgentProjectionTx,
  scope: ProjectAgentEventScopeRef,
  event: Extract<ProjectAgentEventPayload, { kind: 'run.started' }>,
  eventId: bigint,
  expectedFence: ProjectAgentRunFence,
): Promise<void> {
  if (expectedFence.runVersion !== 0 || expectedFence.eventSeq !== '0') {
    throw new Error(`PROJECT_AGENT_RUN_START_FENCE_INVALID runId=${event.runId}`)
  }
  const timestamp = now()
  await tx.projectAgentRun.create({
    data: {
      id: event.runId,
      projectId: scope.projectId,
      userId: scope.userId,
      assistantId: scope.assistantId,
      scopeRef: scope.scopeRef,
      episodeId: scope.episodeId,
      requestId: event.requestId,
      status: 'running',
      runVersion: 1,
      eventSeq: eventId,
      terminalEventSeq: null,
      controlKind: event.controlKind,
      heartbeatAt: timestamp,
    },
  })
}

async function applyActivityStarted(
  tx: ProjectAgentProjectionTx,
  scope: ProjectAgentEventScopeRef,
  event: Extract<ProjectAgentEventPayload, { kind: 'activity.started' }>,
  expectedFence: ProjectAgentRunFence,
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
    expectedFence,
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
  nextFence: ProjectAgentRunFence,
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
      runVersion: nextFence.runVersion,
      eventSeq: BigInt(nextFence.eventSeq),
    },
    update: {
      activityId: event.activityId,
      operationId: event.operationId,
      taskIds: event.taskIds,
      followUpMode: event.followUpMode,
      status: 'pending',
      runVersion: nextFence.runVersion,
      eventSeq: BigInt(nextFence.eventSeq),
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
  nextFence: ProjectAgentRunFence,
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
      runVersion: nextFence.runVersion,
      eventSeq: BigInt(nextFence.eventSeq),
    },
  })
  return getActivitySnapshot(tx, event.activityId)
}

async function applyTaskTerminal(
  tx: ProjectAgentProjectionTx,
  scope: ProjectAgentEventScopeRef,
  event: Extract<ProjectAgentEventPayload, { kind: 'task.terminal' }>,
  expectedFence: ProjectAgentRunFence,
  nextFence: ProjectAgentRunFence,
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
      runVersion: nextFence.runVersion,
      eventSeq: BigInt(nextFence.eventSeq),
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
        expectedFence,
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
      }, expectedFence)
    }
  }
  return getActivitySnapshot(tx, event.activityId)
}

async function applyWaitFollowed(
  tx: ProjectAgentProjectionTx,
  event: Extract<ProjectAgentEventPayload, { kind: 'wait.followed' }>,
  nextFence: ProjectAgentRunFence,
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
      runVersion: nextFence.runVersion,
      eventSeq: BigInt(nextFence.eventSeq),
    },
  })
  return getActivitySnapshot(tx, event.activityId)
}

async function applyInterruptionRaised(
  tx: ProjectAgentProjectionTx,
  scope: ProjectAgentEventScopeRef,
  event: Extract<ProjectAgentEventPayload, { kind: 'interruption.raised' }>,
  expectedFence: ProjectAgentRunFence,
  nextFence: ProjectAgentRunFence,
): Promise<ProjectAgentActivitySnapshot | null> {
  await applyActivityStarted(tx, scope, {
    kind: 'activity.started',
    runId: event.runId,
    activityId: event.activityId,
    type: event.interruptionKind === 'approval' ? 'awaiting_approval' : 'awaiting_choice',
    operationId: event.operationId,
    toolCallId: event.toolCallId ?? null,
    choiceType: event.choiceType ?? null,
  }, expectedFence)
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
      runVersion: nextFence.runVersion,
      eventSeq: BigInt(nextFence.eventSeq),
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
  expectedFence: ProjectAgentRunFence,
  nextFence: ProjectAgentRunFence,
): Promise<ProjectAgentActivitySnapshot | null> {
  const interruption = await tx.projectAgentInterruption.findUnique({
    where: { id: event.interruptionId },
    select: { type: true },
  })
  if (!interruption || (interruption.type !== 'approval' && interruption.type !== 'choice')) {
    throw new Error(`PROJECT_AGENT_INTERRUPTION_TYPE_INVALID:${event.interruptionId}`)
  }
  const resolved = await tx.projectAgentInterruption.updateMany({
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
      runVersion: nextFence.runVersion,
      eventSeq: BigInt(nextFence.eventSeq),
    },
  })
  if (event.outcome === 'consumed' && resolved.count !== 1) {
    throw new Error(
      `PROJECT_AGENT_INTERRUPTION_TRANSITION_RACED interruptionId=${event.interruptionId} runId=${event.runId}`,
    )
  }
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
  if (event.outcome === 'consumed') {
    await markRunStatus(tx, {
      runId: event.runId,
      expectedFence,
      status: 'running',
      expectedStatuses: [interruption.type === 'approval' ? 'awaiting_approval' : 'awaiting_choice'],
      stopReason: interruption.type === 'approval' ? 'approval_response' : 'choice_response',
    })
  }
  return getActivitySnapshot(tx, event.activityId)
}

async function applyInterruptionReopened(
  tx: ProjectAgentProjectionTx,
  event: Extract<ProjectAgentEventPayload, { kind: 'interruption.reopened' }>,
  expectedFence: ProjectAgentRunFence,
  nextFence: ProjectAgentRunFence,
): Promise<ProjectAgentActivitySnapshot | null> {
  const interruption = await tx.projectAgentInterruption.findUnique({
    where: { id: event.interruptionId },
    select: { type: true },
  })
  if (!interruption || (interruption.type !== 'approval' && interruption.type !== 'choice')) {
    throw new Error(`PROJECT_AGENT_INTERRUPTION_TYPE_INVALID:${event.interruptionId}`)
  }
  const reopened = await tx.projectAgentInterruption.updateMany({
    where: {
      id: event.interruptionId,
      runId: event.runId,
      status: 'consumed',
    },
    data: {
      status: 'pending',
      response: Prisma.DbNull,
      consumedAt: null,
      runVersion: nextFence.runVersion,
      eventSeq: BigInt(nextFence.eventSeq),
    },
  })
  if (reopened.count === 1 && event.activityId) {
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
      expectedFence,
      status: interruption.type === 'approval' ? 'awaiting_approval' : 'awaiting_choice',
      expectedStatuses: [
        'running',
        interruption.type === 'approval' ? 'awaiting_approval' : 'awaiting_choice',
      ],
      stopReason: interruption.type === 'approval' ? 'awaiting_approval' : 'awaiting_choice',
    })
  }
  return getActivitySnapshot(tx, event.activityId)
}

async function assertProjectAgentRunEventFence(
  tx: ProjectAgentProjectionTx,
  expectedFence: ProjectAgentRunFence,
): Promise<void> {
  const run = await tx.projectAgentRun.findUnique({
    where: { id: expectedFence.runId },
    select: {
      runVersion: true,
      eventSeq: true,
      terminalEventSeq: true,
    },
  })
  if (!run) throw new Error(`PROJECT_AGENT_RUN_NOT_FOUND:${expectedFence.runId}`)
  if (run.terminalEventSeq !== null) {
    throw new Error(
      `PROJECT_AGENT_RUN_TERMINAL_WATERMARK runId=${expectedFence.runId} terminalEventSeq=${run.terminalEventSeq.toString()}`,
    )
  }
  if (
    run.runVersion !== expectedFence.runVersion
    || run.eventSeq.toString() !== expectedFence.eventSeq
  ) {
    throw new Error(
      `PROJECT_AGENT_RUN_EVENT_STALE runId=${expectedFence.runId} expectedVersion=${expectedFence.runVersion} actualVersion=${run.runVersion} expectedEventSeq=${expectedFence.eventSeq} actualEventSeq=${run.eventSeq.toString()}`,
    )
  }
}

async function finalizeProjectAgentRunEventFence(
  tx: ProjectAgentProjectionTx,
  params: {
    expectedFence: ProjectAgentRunFence
    eventId: bigint
  },
): Promise<void> {
  const run = await tx.projectAgentRun.findUnique({
    where: { id: params.expectedFence.runId },
    select: { status: true },
  })
  if (!run) throw new Error(`PROJECT_AGENT_RUN_NOT_FOUND:${params.expectedFence.runId}`)
  const status = normalizeProjectAgentRunStatus(run.status)
  const updated = await tx.projectAgentRun.updateMany({
    where: {
      id: params.expectedFence.runId,
      runVersion: params.expectedFence.runVersion,
      eventSeq: BigInt(params.expectedFence.eventSeq),
      terminalEventSeq: null,
    },
    data: {
      runVersion: { increment: 1 },
      eventSeq: params.eventId,
      ...(isProjectAgentRunTerminalStatus(status)
        ? { terminalEventSeq: params.eventId }
        : {}),
    },
  })
  if (updated.count !== 1) {
    throw new Error(
      `PROJECT_AGENT_RUN_EVENT_RACED runId=${params.expectedFence.runId} expectedVersion=${params.expectedFence.runVersion} expectedEventSeq=${params.expectedFence.eventSeq}`,
    )
  }
}

export async function reduceProjectAgentEvent(params: {
  tx: ProjectAgentProjectionTx
  scope: ProjectAgentEventScopeRef
  event: ProjectAgentEventPayload
  eventId: bigint
  expectedFence: ProjectAgentRunFence
}): Promise<ProjectAgentActivitySnapshot | null> {
  const { tx, scope, event, eventId, expectedFence } = params
  if (event.runId !== expectedFence.runId) {
    throw new Error(
      `PROJECT_AGENT_EVENT_RUN_FENCE_MISMATCH eventRunId=${event.runId} fenceRunId=${expectedFence.runId}`,
    )
  }
  if (event.kind === 'run.started') {
    await applyRunStarted(tx, scope, event, eventId, expectedFence)
    return null
  }
  await assertProjectAgentRunEventFence(tx, expectedFence)
  const nextFence = advanceProjectAgentRunFence(expectedFence, eventId)
  let activity: ProjectAgentActivitySnapshot | null = null
  switch (event.kind) {
    case 'run.status_changed':
      await markRunStatus(tx, {
        runId: event.runId,
        expectedFence,
        status: event.status,
        expectedStatuses: event.expectedStatuses,
        stopReason: event.stopReason,
        errorCode: event.errorCode,
        errorMessage: event.errorMessage,
      })
      if (event.status === 'failed' || event.status === 'cancelled') {
        await cancelOpenActivitiesForRun(tx, event.runId, event.errorMessage ?? event.stopReason ?? event.status)
      }
      break
    case 'run.completed':
      await markRunStatus(tx, {
        runId: event.runId,
        expectedFence,
        status: 'completed',
        stopReason: event.stopReason ?? 'completed',
      })
      break
    case 'run.failed':
      await markRunStatus(tx, {
        runId: event.runId,
        expectedFence,
        status: 'failed',
        stopReason: event.stopReason ?? 'failed',
        errorCode: event.errorCode,
        errorMessage: event.errorMessage,
      })
      await cancelOpenActivitiesForRun(tx, event.runId, event.errorMessage)
      break
    case 'run.cancelled':
      await markRunStatus(tx, {
        runId: event.runId,
        expectedFence,
        status: 'cancelled',
        stopReason: event.reason,
      })
      await cancelOpenActivitiesForRun(tx, event.runId, event.reason)
      break
    case 'activity.started':
      activity = await applyActivityStarted(tx, scope, event, expectedFence)
      break
    case 'activity.completed':
      activity = await completeActivity(tx, event)
      break
    case 'activity.failed':
      activity = await failActivity(tx, event)
      break
    case 'activity.cancelled':
      activity = await cancelActivity(tx, event)
      break
    case 'task.bound':
      activity = await applyTaskBound(tx, scope, event, nextFence)
      break
    case 'task.progressed':
      activity = await applyTaskProgressed(tx, event, nextFence)
      break
    case 'task.terminal':
      activity = await applyTaskTerminal(tx, scope, event, expectedFence, nextFence)
      break
    case 'wait.followed':
      activity = await applyWaitFollowed(tx, event, nextFence)
      break
    case 'interruption.raised':
      activity = await applyInterruptionRaised(tx, scope, event, expectedFence, nextFence)
      break
    case 'interruption.resolved':
      activity = await applyInterruptionResolved(tx, event, expectedFence, nextFence)
      break
    case 'interruption.reopened':
      activity = await applyInterruptionReopened(tx, event, expectedFence, nextFence)
      break
  }
  await finalizeProjectAgentRunEventFence(tx, { expectedFence, eventId })
  return activity
}
