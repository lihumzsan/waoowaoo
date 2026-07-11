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
import { readProjectAgentDecisionInterruptionId } from '../execution-segment'
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

type LockedProjectAgentRunRow = {
  status: string
  runVersion: number
  eventSeq: bigint
  terminalEventSeq: bigint | null
}

async function loadProjectAgentRunForUpdate(
  tx: ProjectAgentProjectionTx,
  runId: string,
): Promise<LockedProjectAgentRunRow | null> {
  const rows = await tx.$queryRaw<LockedProjectAgentRunRow[]>(Prisma.sql`
    SELECT status, runVersion, eventSeq, terminalEventSeq
    FROM project_agent_runs
    WHERE id = ${runId}
    FOR UPDATE
  `)
  return rows[0] ?? null
}

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

async function abandonOpenWaitsForRun(
  tx: ProjectAgentProjectionTx,
  runId: string,
): Promise<void> {
  await tx.projectAgentWait.updateMany({
    where: {
      runId,
      status: { in: ['pending', 'resolved', 'claimed'] },
    },
    data: {
      status: 'abandoned',
      claimId: null,
      claimedAt: null,
      claimExpiresAt: null,
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
  const current = await loadProjectAgentRunForUpdate(tx, params.runId)
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
  try {
    await tx.projectAgentActivity.create({
      data: {
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
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new Error(
        `PROJECT_AGENT_ACTIVITY_ID_CONFLICT activityId=${event.activityId} runId=${event.runId}`,
        { cause: error },
      )
    }
    throw error
  }
  await markRunStatus(tx, {
    runId: event.runId,
    expectedFence,
    status: runStatusForActivityType(type),
    stopReason: type,
  })
  return getActivitySnapshot(tx, event.activityId)
}

async function transitionProjectAgentActivity(
  tx: ProjectAgentProjectionTx,
  params: {
    runId: string
    activityId: string
    status: 'completed' | 'failed' | 'cancelled'
    data: Prisma.ProjectAgentActivityUpdateManyMutationInput
  },
): Promise<ProjectAgentActivitySnapshot | null> {
  const transitioned = await tx.projectAgentActivity.updateMany({
    where: {
      id: params.activityId,
      runId: params.runId,
      status: { in: OPEN_ACTIVITY_STATUSES },
    },
    data: {
      ...params.data,
      status: params.status,
    },
  })
  if (transitioned.count !== 1) {
    throw new Error(
      `PROJECT_AGENT_ACTIVITY_TRANSITION_RACED activityId=${params.activityId} runId=${params.runId} target=${params.status}`,
    )
  }
  return getActivitySnapshot(tx, params.activityId)
}

async function completeActivity(
  tx: ProjectAgentProjectionTx,
  event: Extract<ProjectAgentEventPayload, { kind: 'activity.completed' }>,
): Promise<ProjectAgentActivitySnapshot | null> {
  return transitionProjectAgentActivity(tx, {
    activityId: event.activityId,
    runId: event.runId,
    status: 'completed',
    data: {
      completedAt: now(),
    },
  })
}

async function failActivity(
  tx: ProjectAgentProjectionTx,
  event: Extract<ProjectAgentEventPayload, { kind: 'activity.failed' }>,
): Promise<ProjectAgentActivitySnapshot | null> {
  return transitionProjectAgentActivity(tx, {
    activityId: event.activityId,
    runId: event.runId,
    status: 'failed',
    data: {
      errorCode: event.errorCode,
      errorMessage: event.errorMessage,
      failedAt: now(),
    },
  })
}

async function cancelActivity(
  tx: ProjectAgentProjectionTx,
  event: Extract<ProjectAgentEventPayload, { kind: 'activity.cancelled' }>,
): Promise<ProjectAgentActivitySnapshot | null> {
  return transitionProjectAgentActivity(tx, {
    activityId: event.activityId,
    runId: event.runId,
    status: 'cancelled',
    data: {
      errorCode: 'PROJECT_AGENT_ACTIVITY_CANCELLED',
      errorMessage: event.reason,
      cancelledAt: now(),
    },
  })
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
      canceledTaskIds: [],
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
      canceledTaskIds: event.canceledTaskIds,
      runVersion: nextFence.runVersion,
      eventSeq: BigInt(nextFence.eventSeq),
    },
  })
  return getActivitySnapshot(tx, event.activityId)
}

async function applyTaskTerminal(
  tx: ProjectAgentProjectionTx,
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
  const nextStatus = event.terminalStatus === 'canceled'
    || (wait.followUpMode === 'complete' && event.terminalStatus === 'completed')
    ? 'followed'
    : 'resolved'
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
      canceledTaskIds: event.canceledTaskIds,
      followUpKey: `project-agent-wait:${event.waitId}:${event.terminalStatus}`,
      followedAt: nextStatus === 'followed' ? now() : null,
      resolvedAt: now(),
      runVersion: nextFence.runVersion,
      eventSeq: BigInt(nextFence.eventSeq),
    },
  })
  const activity = await transitionProjectAgentActivity(tx, {
    activityId: event.activityId,
    runId: event.runId,
    status: event.terminalStatus === 'completed'
      ? 'completed'
      : event.terminalStatus === 'canceled'
        ? 'cancelled'
        : 'failed',
    data: {
      completedAt: event.terminalStatus === 'completed' ? now() : null,
      failedAt: event.terminalStatus === 'failed' ? now() : null,
      cancelledAt: event.terminalStatus === 'canceled' ? now() : null,
      errorCode: event.terminalStatus === 'failed' ? 'PROJECT_AGENT_TASK_FAILED' : null,
      errorMessage: event.terminalStatus === 'failed' ? 'Project agent task wait failed' : null,
    },
  })
  if (event.terminalStatus === 'canceled' && wait.runId) {
    await markRunStatus(tx, {
      runId: wait.runId,
      expectedFence,
      status: 'cancelled',
      stopReason: 'task_cancelled',
    })
  } else if (event.terminalStatus === 'completed' && wait.runId) {
    if (wait.followUpMode === 'complete') {
      await markRunStatus(tx, {
        runId: wait.runId,
        expectedFence,
        status: 'completed',
        stopReason: 'task_completed',
      })
    }
  }
  return activity
}

async function applyWaitFollowed(
  tx: ProjectAgentProjectionTx,
  event: Extract<ProjectAgentEventPayload, { kind: 'wait.followed' }>,
  nextFence: ProjectAgentRunFence,
): Promise<ProjectAgentActivitySnapshot | null> {
  const followed = await tx.projectAgentWait.updateMany({
    where: {
      id: event.waitId,
      runId: event.runId,
      status: 'claimed',
      claimId: event.claimId,
      followUpCommandId: event.commandId,
      followedAt: null,
      claimExpiresAt: { gt: now() },
    },
    data: {
      status: 'followed',
      followedAt: now(),
      runVersion: nextFence.runVersion,
      eventSeq: BigInt(nextFence.eventSeq),
    },
  })
  if (followed.count !== 1) {
    throw new Error(`PROJECT_AGENT_WAIT_FOLLOW_CAS_FAILED:${event.waitId}:${event.commandId}`)
  }
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
      runVersion: nextFence.runVersion,
      eventSeq: BigInt(nextFence.eventSeq),
    },
  })
  if (resolved.count !== 1) {
    throw new Error(
      `PROJECT_AGENT_INTERRUPTION_TRANSITION_RACED interruptionId=${event.interruptionId} runId=${event.runId}`,
    )
  }
  if (event.activityId) {
    await transitionProjectAgentActivity(tx, {
      activityId: event.activityId,
      runId: event.runId,
      status: event.outcome === 'consumed' ? 'completed' : 'cancelled',
      data: {
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

async function assertProjectAgentRunEventFence(
  tx: ProjectAgentProjectionTx,
  expectedFence: ProjectAgentRunFence,
): Promise<void> {
  const run = await loadProjectAgentRunForUpdate(tx, expectedFence.runId)
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
  const run = await loadProjectAgentRunForUpdate(tx, params.expectedFence.runId)
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
        await abandonOpenWaitsForRun(tx, event.runId)
      }
      break
    case 'run.execution_started': {
      if (event.controlKind === 'approval_response') {
        const interruptionId = readProjectAgentDecisionInterruptionId(event.executionSegmentId)
        if (!interruptionId) throw new Error('PROJECT_AGENT_APPROVAL_EXECUTION_SEGMENT_INVALID')
        const cleared = await tx.projectAgentInterruption.updateMany({
          where: {
            id: interruptionId,
            runId: event.runId,
            type: 'approval',
            status: 'consumed',
          },
          data: { runState: null },
        })
        if (cleared.count !== 1) {
          throw new Error(`PROJECT_AGENT_APPROVAL_RUN_STATE_CLEAR_RACED:${interruptionId}`)
        }
      }
      break
    }
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
      await abandonOpenWaitsForRun(tx, event.runId)
      break
    case 'run.cancelled':
      await markRunStatus(tx, {
        runId: event.runId,
        expectedFence,
        status: 'cancelled',
        stopReason: event.reason,
      })
      await cancelOpenActivitiesForRun(tx, event.runId, event.reason)
      await abandonOpenWaitsForRun(tx, event.runId)
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
      activity = await applyTaskTerminal(tx, event, expectedFence, nextFence)
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
  }
  await finalizeProjectAgentRunEventFence(tx, { expectedFence, eventId })
  return activity
}
