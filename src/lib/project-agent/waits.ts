import { createHash, randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { TASK_EVENT_TYPE, TASK_STATUS, type TaskLifecycleEventType } from '@/lib/task/types'
import type { ProjectAssistantId } from './types'
import { buildProjectAssistantScopeRef } from './persistence'
import { appendProjectAgentEvents, appendProjectAgentEventsInTransaction } from './event'
import { createOutboxCommandInTransaction } from '@/lib/outbox/repository'
import { OUTBOX_COMMAND_KIND } from '@/lib/outbox/types'
import {
  isProjectAgentRunWakeupBudgetAvailable,
  PROJECT_AGENT_RUN_WAKEUP_LIMIT,
} from './run-budget'
import {
  createProjectAgentRunFence,
  type ProjectAgentRunFence,
} from './run-fence'

export type ProjectAgentWaitStatus = 'pending' | 'resolved' | 'claimed' | 'followed'
export type ProjectAgentWaitTerminalStatus = 'completed' | 'failed' | 'canceled'

/**
 * What happens when every task behind the wait reaches a terminal state.
 * - resume_agent: the wait becomes claimable and the agent is woken with a follow-up turn.
 * - await_user_choice: completion means the user must pick something next; the wait is
 *   closed immediately and the agent is never woken. Failures still resume the agent
 *   so it can report and recover.
 * The mode is declared on the operation definition (agentFlow.onTaskComplete) and
 * recorded here when the wait is created.
 */
export type ProjectAgentWaitFollowUpMode = 'resume_agent' | 'await_user_choice' | 'complete'

interface ProjectAgentWaitScopeInput {
  projectId: string
  userId: string
  episodeId?: string | null
  assistantId?: ProjectAssistantId
}

export interface CreateProjectAgentWaitInput extends ProjectAgentWaitScopeInput {
  runFence: ProjectAgentRunFence
  runId: string
  operationId: string
  taskIds: string[]
  followUpMode: ProjectAgentWaitFollowUpMode
}

interface ProjectAgentWaitRow {
  id: string
  runId: string | null
  activityId: string | null
  projectId: string
  userId: string
  assistantId: string
  scopeRef: string
  episodeId: string | null
  operationId: string
  taskIds: unknown
  followUpMode: string
  status: string
  runVersion: number
  eventSeq: bigint
  terminalStatus: string | null
  terminalTaskIds: unknown | null
  failedTaskIds: unknown | null
  canceledTaskIds: unknown | null
  followUpKey: string | null
  followUpCommandId: string | null
  claimId: string | null
  claimedAt: Date | null
  claimExpiresAt: Date | null
  followedAt: Date | null
  createdAt: Date
  resolvedAt: Date | null
}

interface ProjectAgentWaitFailedTaskRow {
  id: string
  type: string | null
  targetType: string | null
  targetId: string | null
  status: string | null
  errorCode: string | null
  errorMessage: string | null
}

export interface ProjectAgentWaitTaskSnapshot {
  id: string
  status: string
}

export interface ProjectAgentWaitFailedTask {
  taskId: string
  taskType: string | null
  targetType: string | null
  targetId: string | null
  status: string | null
  errorCode: string | null
  errorMessage: string | null
}

export interface ProjectAgentWaitFollowUp {
  runId: string | null
  activityId: string | null
  followUpActivityId: string | null
  waitId: string
  followUpKey: string
  followUpMode: ProjectAgentWaitFollowUpMode
  operationId: string
  taskIds: string[]
  failedTaskIds: string[]
  canceledTaskIds: string[]
  failedTasks: ProjectAgentWaitFailedTask[]
  terminalStatus: ProjectAgentWaitTerminalStatus
  total: number
  successCount: number
  failedCount: number
  canceledCount: number
  claimId: string
  commandId: string
}

export interface ProjectAgentSessionWait {
  runId: string | null
  activityId: string | null
  waitId: string
  operationId: string
  taskIds: string[]
  failedTaskIds: string[]
  canceledTaskIds: string[]
  status: ProjectAgentWaitStatus
  followUpMode: ProjectAgentWaitFollowUpMode
  terminalStatus: ProjectAgentWaitTerminalStatus | null
  total: number
  claimId: string | null
}

const WAIT_CLAIM_TTL_MS = 2 * 60 * 1000
export const PROJECT_AGENT_EVENT_IDEMPOTENCY_KEY_MAX_LENGTH = 191

function normalizeTaskIds(taskIds: string[]): string[] {
  return Array.from(new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean))).sort()
}

function hashWaitTerminalTaskState(input: {
  terminalTaskIds: string[]
  failedTaskIds: string[]
  canceledTaskIds?: string[]
}): string {
  return createHash('sha256').update(JSON.stringify({
    terminalTaskIds: normalizeTaskIds(input.terminalTaskIds),
    failedTaskIds: normalizeTaskIds(input.failedTaskIds),
    canceledTaskIds: normalizeTaskIds(input.canceledTaskIds ?? []),
  })).digest('hex')
}

function enforceProjectAgentEventIdempotencyKeyLimit(key: string): string {
  if (key.length > PROJECT_AGENT_EVENT_IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new Error(`PROJECT_AGENT_EVENT_IDEMPOTENCY_KEY_TOO_LONG:${key.length}`)
  }
  return key
}

export function buildProjectAgentTaskProgressedIdempotencyKey(input: {
  waitId: string
  terminalTaskIds: string[]
  failedTaskIds: string[]
  canceledTaskIds?: string[]
}): string {
  const hash = hashWaitTerminalTaskState({
    terminalTaskIds: input.terminalTaskIds,
    failedTaskIds: input.failedTaskIds,
    canceledTaskIds: input.canceledTaskIds,
  })
  return enforceProjectAgentEventIdempotencyKeyLimit(`task-progressed:${input.waitId}:${hash}`)
}

export function buildProjectAgentTaskTerminalIdempotencyKey(input: {
  waitId: string
  terminalStatus: ProjectAgentWaitTerminalStatus
  terminalTaskIds: string[]
  failedTaskIds: string[]
  canceledTaskIds?: string[]
}): string {
  const hash = hashWaitTerminalTaskState({
    terminalTaskIds: input.terminalTaskIds,
    failedTaskIds: input.failedTaskIds,
    canceledTaskIds: input.canceledTaskIds,
  })
  return enforceProjectAgentEventIdempotencyKeyLimit(`task-terminal:${input.waitId}:${input.terminalStatus}:${hash}`)
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return normalizeTaskIds(value.flatMap((item) => typeof item === 'string' ? [item] : []))
  }
  if (typeof value !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(value)
    return parseStringArray(parsed)
  } catch {
    return []
  }
}

async function readFailedTaskDetails(input: {
  projectId: string
  userId: string
  failedTaskIds: string[]
}): Promise<ProjectAgentWaitFailedTask[]> {
  const failedTaskIds = normalizeTaskIds(input.failedTaskIds)
  if (failedTaskIds.length === 0) return []
  const rows = await prisma.$queryRaw<ProjectAgentWaitFailedTaskRow[]>(Prisma.sql`
    SELECT id, type, targetType, targetId, status, errorCode, errorMessage
    FROM tasks
    WHERE projectId = ${input.projectId}
      AND userId = ${input.userId}
      AND id IN (${Prisma.join(failedTaskIds)})
  `)
  const rowById = new Map(rows.map((row) => [row.id, row]))
  return failedTaskIds.map((taskId) => {
    const row = rowById.get(taskId)
    return {
      taskId,
      taskType: row?.type ?? null,
      targetType: row?.targetType ?? null,
      targetId: row?.targetId ?? null,
      status: row?.status ?? null,
      errorCode: row?.errorCode ?? null,
      errorMessage: row?.errorMessage ?? null,
    }
  })
}

async function buildWaitFollowUpFromRow(
  row: ProjectAgentWaitRow,
  params: {
    claimId?: string | null
    followUpActivityId: string | null
  },
): Promise<ProjectAgentWaitFollowUp | null> {
  if (row.terminalStatus !== 'completed' && row.terminalStatus !== 'failed' && row.terminalStatus !== 'canceled') return null
  if (!row.followUpKey) return null
  const taskIds = parseStringArray(row.taskIds)
  const failedTaskIds = parseStringArray(row.failedTaskIds)
  const canceledTaskIds = parseStringArray(row.canceledTaskIds)
  const failedTasks = await readFailedTaskDetails({
    projectId: row.projectId,
    userId: row.userId,
    failedTaskIds,
  })
  return {
    runId: row.runId,
    activityId: row.activityId,
    followUpActivityId: params.followUpActivityId,
    waitId: row.id,
    followUpKey: row.followUpKey,
    followUpMode: normalizeWaitFollowUpMode(row.followUpMode),
    operationId: row.operationId,
    taskIds,
    failedTaskIds,
    canceledTaskIds,
    failedTasks,
    terminalStatus: row.terminalStatus,
    total: taskIds.length,
    successCount: Math.max(taskIds.length - failedTaskIds.length - canceledTaskIds.length, 0),
    failedCount: failedTaskIds.length,
    canceledCount: canceledTaskIds.length,
    claimId: params.claimId ?? row.claimId ?? '',
    commandId: row.followUpCommandId ?? '',
  }
}

function readTerminalLifecycleTypeFromTaskStatus(status: string): TaskLifecycleEventType | null {
  if (status === TASK_STATUS.COMPLETED) return TASK_EVENT_TYPE.COMPLETED
  if (status === TASK_STATUS.FAILED) return TASK_EVENT_TYPE.FAILED
  if (status === TASK_STATUS.CANCELED) return TASK_EVENT_TYPE.CANCELED
  return null
}

export function applyProjectAgentWaitTaskSnapshot(input: {
  taskIds: string[]
  tasks: ProjectAgentWaitTaskSnapshot[]
}): ApplyProjectAgentWaitTerminalEventResult {
  const taskIds = normalizeTaskIds(input.taskIds)
  let terminalTaskIds: string[] = []
  let failedTaskIds: string[] = []
  let canceledTaskIds: string[] = []
  let terminalStatus: ProjectAgentWaitTerminalStatus | null = null

  for (const task of input.tasks) {
    const lifecycleType = readTerminalLifecycleTypeFromTaskStatus(task.status)
    if (!lifecycleType) continue
    const result = applyProjectAgentWaitTerminalEvent({
      taskId: task.id,
      lifecycleType,
      taskIds,
      terminalTaskIds,
      failedTaskIds,
      canceledTaskIds,
    })
    terminalTaskIds = result.terminalTaskIds
    failedTaskIds = result.failedTaskIds
    canceledTaskIds = result.canceledTaskIds
    terminalStatus = result.terminalStatus
  }

  return {
    terminalTaskIds,
    failedTaskIds,
    canceledTaskIds,
    terminalStatus,
  }
}

function buildWaitScope(input: ProjectAgentWaitScopeInput): {
  assistantId: ProjectAssistantId
  scopeRef: string
} {
  const assistantId = input.assistantId ?? 'workspace-command'
  return {
    assistantId,
    scopeRef: buildProjectAssistantScopeRef({
      projectId: input.projectId,
      episodeId: input.episodeId ?? null,
    }),
  }
}

function normalizeWaitFollowUpMode(value: string): ProjectAgentWaitFollowUpMode {
  if (value === 'resume_agent' || value === 'await_user_choice' || value === 'complete') return value
  throw new Error(`PROJECT_AGENT_WAIT_FOLLOW_UP_MODE_INVALID:${value}`)
}

function normalizeWaitStatus(value: string): ProjectAgentWaitStatus {
  if (value === 'pending' || value === 'resolved' || value === 'claimed' || value === 'followed') return value
  throw new Error(`PROJECT_AGENT_WAIT_STATUS_INVALID:${value}`)
}

function normalizeWaitTerminalStatus(value: string | null): ProjectAgentWaitTerminalStatus | null {
  if (value === null) return null
  if (value === 'completed' || value === 'failed' || value === 'canceled') return value
  throw new Error(`PROJECT_AGENT_WAIT_TERMINAL_STATUS_INVALID:${value}`)
}

export async function createProjectAgentWait(input: CreateProjectAgentWaitInput): Promise<string | null> {
  const taskIds = normalizeTaskIds(input.taskIds)
  if (taskIds.length === 0) return null
  const waitId = randomUUID()
  const activityId = randomUUID()
  await prisma.$transaction(async (tx) => {
    const { assistantId, scopeRef } = buildWaitScope(input)
    await appendProjectAgentEventsInTransaction(tx, {
      scope: {
        projectId: input.projectId,
        userId: input.userId,
        episodeId: input.episodeId ?? null,
        assistantId,
        scopeRef,
      },
      events: [
      {
        runFence: input.runFence,
        idempotencyKey: `activity-started:${activityId}`,
        event: {
          kind: 'activity.started',
          runId: input.runId,
          activityId,
          type: 'waiting_task',
          operationId: input.operationId,
        },
      },
      {
        runFence: input.runFence,
        idempotencyKey: `task-bound:${waitId}`,
        event: {
          kind: 'task.bound',
          runId: input.runId,
          activityId,
          waitId,
          operationId: input.operationId,
          taskIds,
          followUpMode: input.followUpMode,
        },
      },
      ],
    })
    const tasks = await tx.$queryRaw<ProjectAgentWaitTaskSnapshot[]>(Prisma.sql`
      SELECT id, status
      FROM tasks
      WHERE projectId = ${input.projectId}
        AND userId = ${input.userId}
        AND id IN (${Prisma.join(taskIds)})
    `)
    const terminalTask = tasks.find((task) => readTerminalLifecycleTypeFromTaskStatus(task.status) !== null)
    if (!terminalTask) return
    const terminalType = readTerminalLifecycleTypeFromTaskStatus(terminalTask.status)
    if (!terminalType) throw new Error(`PROJECT_AGENT_WAIT_TERMINAL_TYPE_MISSING:${terminalTask.id}`)
    await resolveProjectAgentWaitsForTaskTerminalInTransaction(tx, {
      taskId: terminalTask.id,
      projectId: input.projectId,
      userId: input.userId,
      lifecycleType: terminalType,
    })
  })
  return waitId
}

export interface ApplyProjectAgentWaitTerminalEventInput {
  taskId: string
  lifecycleType: TaskLifecycleEventType
  taskIds: string[]
  terminalTaskIds: string[]
  failedTaskIds: string[]
  canceledTaskIds: string[]
}

export interface ApplyProjectAgentWaitTerminalEventResult {
  terminalTaskIds: string[]
  failedTaskIds: string[]
  canceledTaskIds: string[]
  terminalStatus: ProjectAgentWaitTerminalStatus | null
}

export function applyProjectAgentWaitTerminalEvent(
  input: ApplyProjectAgentWaitTerminalEventInput,
): ApplyProjectAgentWaitTerminalEventResult {
  const taskIds = normalizeTaskIds(input.taskIds)
  if (!taskIds.includes(input.taskId)) {
    return {
      terminalTaskIds: normalizeTaskIds(input.terminalTaskIds),
      failedTaskIds: normalizeTaskIds(input.failedTaskIds),
      canceledTaskIds: normalizeTaskIds(input.canceledTaskIds),
      terminalStatus: null,
    }
  }

  const terminalTaskIds = normalizeTaskIds([...input.terminalTaskIds, input.taskId])
  const failedTaskIds = input.lifecycleType === TASK_EVENT_TYPE.FAILED
    ? normalizeTaskIds([...input.failedTaskIds, input.taskId])
    : normalizeTaskIds(input.failedTaskIds)
  const canceledTaskIds = input.lifecycleType === TASK_EVENT_TYPE.CANCELED
    ? normalizeTaskIds([...input.canceledTaskIds, input.taskId])
    : normalizeTaskIds(input.canceledTaskIds)
  const allTerminal = taskIds.every((taskId) => terminalTaskIds.includes(taskId))

  return {
    terminalTaskIds,
    failedTaskIds,
    canceledTaskIds,
    terminalStatus: allTerminal
      ? failedTaskIds.length > 0
        ? 'failed'
        : canceledTaskIds.length > 0
          ? 'canceled'
          : 'completed'
      : null,
  }
}

/**
 * Pure decision: a completed await_user_choice wait is closed immediately
 * (the next step belongs to the user, not the agent); everything else becomes
 * claimable so a follow-up turn can wake the agent.
 */
export function resolveWaitTerminalNextStatus(params: {
  followUpMode: string
  terminalStatus: ProjectAgentWaitTerminalStatus
}): Extract<ProjectAgentWaitStatus, 'resolved' | 'followed'> {
  if (params.terminalStatus === 'canceled') return 'followed'
  if (
    (params.followUpMode === 'await_user_choice' || params.followUpMode === 'complete')
    && params.terminalStatus === 'completed'
  ) {
    return 'followed'
  }
  return 'resolved'
}

async function applyWaitTerminalStatus(input: {
  waitId: string
  runId: string
  runFence: ProjectAgentRunFence
  activityId: string
  projectId: string
  userId: string
  episodeId?: string | null
  assistantId?: ProjectAssistantId
  followUpMode: string
  terminalStatus: ProjectAgentWaitTerminalStatus
  terminalTaskIds: string[]
  failedTaskIds: string[]
  canceledTaskIds: string[]
}): Promise<void> {
  const nextActivityId = input.followUpMode === 'await_user_choice'
    && input.terminalStatus === 'completed'
    && input.runId
    ? randomUUID()
    : null
  await appendProjectAgentEvents({
    scope: {
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId ?? null,
      assistantId: input.assistantId,
    },
    events: [{
      runFence: input.runFence,
      idempotencyKey: buildProjectAgentTaskTerminalIdempotencyKey({
        waitId: input.waitId,
        terminalStatus: input.terminalStatus,
        terminalTaskIds: input.terminalTaskIds,
        failedTaskIds: input.failedTaskIds,
        canceledTaskIds: input.canceledTaskIds,
      }),
      event: {
        kind: 'task.terminal',
        runId: input.runId,
        activityId: input.activityId,
        waitId: input.waitId,
        terminalStatus: input.terminalStatus,
        terminalTaskIds: input.terminalTaskIds,
        failedTaskIds: input.failedTaskIds,
        canceledTaskIds: input.canceledTaskIds,
        nextActivityId,
      },
    }],
  })
}

async function resolveNewProjectAgentWaitFromCurrentTasks(input: {
  waitId: string
  runId: string
  runFence: ProjectAgentRunFence
  activityId: string
  projectId: string
  userId: string
  episodeId?: string | null
  assistantId?: ProjectAssistantId
  taskIds: string[]
  followUpMode: ProjectAgentWaitFollowUpMode
}): Promise<void> {
  const tasks = await prisma.$queryRaw<ProjectAgentWaitTaskSnapshot[]>(Prisma.sql`
    SELECT id, status
    FROM tasks
    WHERE projectId = ${input.projectId}
      AND userId = ${input.userId}
      AND id IN (${Prisma.join(input.taskIds)})
  `)
  const result = applyProjectAgentWaitTaskSnapshot({
    taskIds: input.taskIds,
    tasks,
  })
  if (result.terminalTaskIds.length === 0) return

  if (!result.terminalStatus) {
    await appendProjectAgentEvents({
      scope: input,
      events: [{
        runFence: input.runFence,
        idempotencyKey: buildProjectAgentTaskProgressedIdempotencyKey({
          waitId: input.waitId,
          terminalTaskIds: result.terminalTaskIds,
          failedTaskIds: result.failedTaskIds,
          canceledTaskIds: result.canceledTaskIds,
        }),
        event: {
          kind: 'task.progressed',
          runId: input.runId,
          activityId: input.activityId,
          waitId: input.waitId,
          terminalTaskIds: result.terminalTaskIds,
          failedTaskIds: result.failedTaskIds,
          canceledTaskIds: result.canceledTaskIds,
        },
      }],
    })
    return
  }

  await applyWaitTerminalStatus({
    runFence: input.runFence,
    waitId: input.waitId,
    runId: input.runId,
    activityId: input.activityId,
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId,
    assistantId: input.assistantId,
    followUpMode: input.followUpMode,
    terminalStatus: result.terminalStatus,
    terminalTaskIds: result.terminalTaskIds,
    failedTaskIds: result.failedTaskIds,
    canceledTaskIds: result.canceledTaskIds,
  })
}

export async function resolveProjectAgentWaitsForTaskTerminalInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    taskId: string
    projectId: string
    userId: string
    lifecycleType: TaskLifecycleEventType
  },
): Promise<string[]> {
  if (
    input.lifecycleType !== TASK_EVENT_TYPE.COMPLETED
    && input.lifecycleType !== TASK_EVENT_TYPE.FAILED
    && input.lifecycleType !== TASK_EVENT_TYPE.CANCELED
  ) return []

  const rows = await tx.$queryRaw<ProjectAgentWaitRow[]>(Prisma.sql`
    SELECT
      id,
      runId,
      activityId,
      projectId,
      userId,
      assistantId,
      scopeRef,
      episodeId,
      operationId,
      taskIds,
      followUpMode,
      status,
      runVersion,
      eventSeq,
      terminalStatus,
      terminalTaskIds,
      failedTaskIds,
      canceledTaskIds,
      followUpKey,
      claimId,
      claimedAt,
      claimExpiresAt,
      followedAt,
      createdAt,
      resolvedAt
    FROM project_agent_waits
    WHERE projectId = ${input.projectId}
      AND userId = ${input.userId}
      AND status = 'pending'
      AND JSON_CONTAINS(taskIds, JSON_QUOTE(${input.taskId}))
    ORDER BY id ASC
    FOR UPDATE
  `)

  const outboxCommandIds: string[] = []
  for (const row of rows) {
    if (!row.runId) throw new Error(`PROJECT_AGENT_WAIT_RUN_MISSING:${row.id}`)
    if (!row.activityId) throw new Error(`PROJECT_AGENT_WAIT_ACTIVITY_MISSING:${row.id}`)
    const taskIds = parseStringArray(row.taskIds)
    const tasks = await tx.$queryRaw<ProjectAgentWaitTaskSnapshot[]>(Prisma.sql`
      SELECT id, status
      FROM tasks
      WHERE projectId = ${row.projectId}
        AND userId = ${row.userId}
        AND id IN (${Prisma.join(taskIds)})
    `)
    const result = applyProjectAgentWaitTaskSnapshot({ taskIds, tasks })
    if (result.terminalTaskIds.length === 0) continue
    const runFence = createProjectAgentRunFence({
      id: row.runId,
      runVersion: row.runVersion,
      eventSeq: row.eventSeq,
    })
    const scope = {
      projectId: row.projectId,
      userId: row.userId,
      episodeId: row.episodeId,
      assistantId: row.assistantId as ProjectAssistantId,
      scopeRef: row.scopeRef,
    }

    if (!result.terminalStatus) {
      await appendProjectAgentEventsInTransaction(tx, {
        scope,
        events: [{
          runFence,
          idempotencyKey: buildProjectAgentTaskProgressedIdempotencyKey({
            waitId: row.id,
            terminalTaskIds: result.terminalTaskIds,
            failedTaskIds: result.failedTaskIds,
            canceledTaskIds: result.canceledTaskIds,
          }),
          event: {
            kind: 'task.progressed',
            runId: row.runId,
            activityId: row.activityId,
            waitId: row.id,
            terminalTaskIds: result.terminalTaskIds,
            failedTaskIds: result.failedTaskIds,
            canceledTaskIds: result.canceledTaskIds,
          },
        }],
      })
      continue
    }

    const nextStatus = resolveWaitTerminalNextStatus({
      followUpMode: row.followUpMode,
      terminalStatus: result.terminalStatus,
    })
    const nextActivityId = row.followUpMode === 'await_user_choice'
      && result.terminalStatus === 'completed'
      ? randomUUID()
      : null
    await appendProjectAgentEventsInTransaction(tx, {
      scope,
      events: [{
        runFence,
        idempotencyKey: buildProjectAgentTaskTerminalIdempotencyKey({
          waitId: row.id,
          terminalStatus: result.terminalStatus,
          terminalTaskIds: result.terminalTaskIds,
          failedTaskIds: result.failedTaskIds,
          canceledTaskIds: result.canceledTaskIds,
        }),
        event: {
          kind: 'task.terminal',
          runId: row.runId,
          activityId: row.activityId,
          waitId: row.id,
          terminalStatus: result.terminalStatus,
          terminalTaskIds: result.terminalTaskIds,
          failedTaskIds: result.failedTaskIds,
          canceledTaskIds: result.canceledTaskIds,
          nextActivityId,
        },
      }],
    })
    if (nextStatus === 'resolved') {
      const command = await createOutboxCommandInTransaction(tx, {
        idempotencyKey: `project-agent-wait-continuation:${row.id}:${runFence.eventSeq}`,
        aggregateType: 'project_agent_wait',
        aggregateId: row.id,
        payload: {
          kind: OUTBOX_COMMAND_KIND.PROJECT_AGENT_CONTINUE_WAIT,
          version: 1,
          waitId: row.id,
          runId: row.runId,
          expectedRunVersion: runFence.runVersion,
          expectedEventSeq: runFence.eventSeq,
        },
      })
      outboxCommandIds.push(command.id)
    }
  }
  return outboxCommandIds
}

export async function resolveProjectAgentWaitsForTaskEvent(input: {
  taskId: string
  projectId: string
  userId: string
  lifecycleType: TaskLifecycleEventType
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await resolveProjectAgentWaitsForTaskTerminalInTransaction(tx, input)
  })
}

async function reconcilePendingProjectAgentWaitsForScope(input: ProjectAgentWaitScopeInput): Promise<void> {
  const { assistantId, scopeRef } = buildWaitScope(input)
  const rows = await prisma.$queryRaw<ProjectAgentWaitRow[]>`
    SELECT
      id,
      runId,
      activityId,
      projectId,
      userId,
      assistantId,
      scopeRef,
      episodeId,
      operationId,
      taskIds,
      followUpMode,
      status,
      runVersion,
      eventSeq,
      terminalStatus,
      terminalTaskIds,
      failedTaskIds,
      canceledTaskIds,
      followUpKey,
      claimId,
      claimedAt,
      claimExpiresAt,
      followedAt,
      createdAt,
      resolvedAt
    FROM project_agent_waits
    WHERE projectId = ${input.projectId}
      AND userId = ${input.userId}
      AND assistantId = ${assistantId}
      AND scopeRef = ${scopeRef}
      AND status = 'pending'
    ORDER BY createdAt ASC
  `

  for (const row of rows) {
    if (!row.runId) throw new Error(`PROJECT_AGENT_WAIT_RUN_MISSING:${row.id}`)
    if (!row.activityId) throw new Error(`PROJECT_AGENT_WAIT_ACTIVITY_MISSING:${row.id}`)
    await resolveNewProjectAgentWaitFromCurrentTasks({
      runFence: createProjectAgentRunFence({
        id: row.runId,
        runVersion: row.runVersion,
        eventSeq: row.eventSeq,
      }),
      waitId: row.id,
      runId: row.runId,
      activityId: row.activityId,
      projectId: row.projectId,
      userId: row.userId,
      episodeId: row.episodeId,
      assistantId: row.assistantId as ProjectAssistantId,
      taskIds: parseStringArray(row.taskIds),
      followUpMode: normalizeWaitFollowUpMode(row.followUpMode),
    })
  }
}

export async function listResolvedProjectAgentWaitFollowUps(input: ProjectAgentWaitScopeInput & {
  limit?: number
}): Promise<ProjectAgentWaitFollowUp[]> {
  const { assistantId, scopeRef } = buildWaitScope(input)
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 10), 1), 50)
  const rows = await prisma.$queryRaw<ProjectAgentWaitRow[]>(Prisma.sql`
    SELECT
      id,
      runId,
      activityId,
      projectId,
      userId,
      assistantId,
      scopeRef,
      episodeId,
      operationId,
      taskIds,
      followUpMode,
      status,
      runVersion,
      eventSeq,
      terminalStatus,
      terminalTaskIds,
      failedTaskIds,
      canceledTaskIds,
      followUpKey,
      claimId,
      followedAt,
      createdAt,
      resolvedAt
    FROM project_agent_waits
    WHERE projectId = ${input.projectId}
      AND userId = ${input.userId}
      AND assistantId = ${assistantId}
      AND scopeRef = ${scopeRef}
      AND status = 'resolved'
      AND followedAt IS NULL
      AND followUpKey IS NOT NULL
    ORDER BY resolvedAt ASC
    LIMIT ${limit}
  `)

  const followUps: ProjectAgentWaitFollowUp[] = []
  for (const row of rows) {
    const followUp = await buildWaitFollowUpFromRow(row, {
      claimId: row.claimId,
      followUpActivityId: null,
    })
    if (followUp) followUps.push(followUp)
  }
  return followUps
}

export async function listProjectAgentSessionWaits(input: ProjectAgentWaitScopeInput & {
  limit?: number
}): Promise<ProjectAgentSessionWait[]> {
  const { assistantId, scopeRef } = buildWaitScope(input)
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 10), 1), 50)
  const rows = await prisma.$queryRaw<ProjectAgentWaitRow[]>(Prisma.sql`
    SELECT
      id,
      runId,
      activityId,
      projectId,
      userId,
      assistantId,
      scopeRef,
      episodeId,
      operationId,
      taskIds,
      followUpMode,
      status,
      runVersion,
      eventSeq,
      terminalStatus,
      terminalTaskIds,
      failedTaskIds,
      canceledTaskIds,
      followUpKey,
      claimId,
      claimedAt,
      claimExpiresAt,
      followedAt,
      createdAt,
      resolvedAt
    FROM project_agent_waits
    WHERE projectId = ${input.projectId}
      AND userId = ${input.userId}
      AND assistantId = ${assistantId}
      AND scopeRef = ${scopeRef}
      AND status IN ('pending', 'resolved', 'claimed')
    ORDER BY createdAt DESC
    LIMIT ${limit}
  `)

  return rows.map((row) => {
    const taskIds = parseStringArray(row.taskIds)
    const failedTaskIds = parseStringArray(row.failedTaskIds)
    const canceledTaskIds = parseStringArray(row.canceledTaskIds)
    return {
      runId: row.runId,
      activityId: row.activityId,
      waitId: row.id,
      operationId: row.operationId,
      taskIds,
      failedTaskIds,
      canceledTaskIds,
      status: normalizeWaitStatus(row.status),
      followUpMode: normalizeWaitFollowUpMode(row.followUpMode),
      terminalStatus: normalizeWaitTerminalStatus(row.terminalStatus),
      total: taskIds.length,
      claimId: row.claimId,
    }
  })
}

export async function claimResolvedProjectAgentWaitFollowUps(input: ProjectAgentWaitScopeInput & {
  limit?: number
  claimTtlMs?: number
  followUpMode?: ProjectAgentWaitFollowUpMode
}): Promise<ProjectAgentWaitFollowUp[]> {
  const { assistantId, scopeRef } = buildWaitScope(input)
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 1), 1), 10)
  const claimTtlMs = Math.min(Math.max(Math.floor(input.claimTtlMs ?? WAIT_CLAIM_TTL_MS), 30_000), 10 * 60 * 1000)
  const claimId = randomUUID()
  const claimExpiresAt = new Date(Date.now() + claimTtlMs)

  await prisma.$executeRaw`
    UPDATE project_agent_waits
    SET status = 'resolved',
        claimId = NULL,
        claimedAt = NULL,
        claimExpiresAt = NULL,
        updatedAt = NOW(3)
    WHERE projectId = ${input.projectId}
      AND userId = ${input.userId}
      AND assistantId = ${assistantId}
      AND scopeRef = ${scopeRef}
      AND status = 'claimed'
      AND followedAt IS NULL
      AND claimExpiresAt < NOW(3)
  `

  await prisma.$executeRaw`
    UPDATE project_agent_waits
    SET status = 'claimed',
        claimId = ${claimId},
        claimedAt = NOW(3),
        claimExpiresAt = ${claimExpiresAt},
        updatedAt = NOW(3)
    WHERE projectId = ${input.projectId}
      AND userId = ${input.userId}
      AND assistantId = ${assistantId}
      AND scopeRef = ${scopeRef}
      AND status = 'resolved'
      AND followedAt IS NULL
      AND followUpKey IS NOT NULL
      ${input.followUpMode ? Prisma.sql`AND followUpMode = ${input.followUpMode}` : Prisma.empty}
    ORDER BY resolvedAt ASC
    LIMIT ${limit}
  `

  const rows = await prisma.$queryRaw<ProjectAgentWaitRow[]>`
    SELECT
      id,
      runId,
      activityId,
      projectId,
      userId,
      assistantId,
      scopeRef,
      episodeId,
      operationId,
      taskIds,
      followUpMode,
      status,
      runVersion,
      eventSeq,
      terminalStatus,
      terminalTaskIds,
      failedTaskIds,
      canceledTaskIds,
      followUpKey,
      claimId,
      claimedAt,
      claimExpiresAt,
      followedAt,
      createdAt,
      resolvedAt
    FROM project_agent_waits
    WHERE projectId = ${input.projectId}
      AND userId = ${input.userId}
      AND assistantId = ${assistantId}
      AND scopeRef = ${scopeRef}
      AND status = 'claimed'
      AND claimId = ${claimId}
    ORDER BY resolvedAt ASC
  `

  const followUps: ProjectAgentWaitFollowUp[] = []
  for (const row of rows) {
    if (!row.claimId) continue
    const followUp = await buildWaitFollowUpFromRow(row, {
      claimId: row.claimId,
      followUpActivityId: null,
    })
    if (followUp) followUps.push(followUp)
  }
  return followUps
}

export type ProjectAgentContinuationClaimResult =
  | {
      status: 'claimed'
      followUp: ProjectAgentWaitFollowUp
      projectId: string
      userId: string
      episodeId: string | null
    }
  | { status: 'already_followed' }
  | { status: 'busy' }
  | { status: 'stale_or_not_claimable' }

export async function claimProjectAgentWaitContinuation(input: {
  waitId: string
  runId: string
  expectedRunVersion: number
  expectedEventSeq: string
  commandId: string
  claimOwner: string
  claimTtlMs?: number
}): Promise<ProjectAgentContinuationClaimResult> {
  const eventSeq = BigInt(input.expectedEventSeq)
  const claimTtlMs = Math.min(
    Math.max(Math.floor(input.claimTtlMs ?? 10 * 60 * 1000), 30_000),
    30 * 60 * 1000,
  )
  const claimExpiresAt = new Date(Date.now() + claimTtlMs)
  return await prisma.$transaction(async (tx) => {
    const current = await tx.projectAgentWait.findUnique({ where: { id: input.waitId } })
    if (!current || current.runId !== input.runId) return { status: 'stale_or_not_claimable' }
    if (current.status === 'followed' && current.followUpCommandId === input.commandId) {
      return { status: 'already_followed' }
    }
    if (
      current.followUpCommandId !== null
      && current.followUpCommandId !== input.commandId
    ) return { status: 'stale_or_not_claimable' }
    if (
      current.status === 'claimed'
      && current.claimExpiresAt
      && current.claimExpiresAt.getTime() >= Date.now()
    ) return { status: 'busy' }
    const claimed = await tx.projectAgentWait.updateMany({
      where: {
        id: input.waitId,
        runId: input.runId,
        runVersion: input.expectedRunVersion,
        eventSeq,
        followedAt: null,
        OR: [
          { status: 'resolved' },
          { status: 'claimed', claimExpiresAt: { lt: new Date() } },
        ],
      },
      data: {
        status: 'claimed',
        followUpCommandId: input.commandId,
        claimId: input.claimOwner,
        claimedAt: new Date(),
        claimExpiresAt,
      },
    })
    if (claimed.count !== 1) return { status: 'stale_or_not_claimable' }
    const row = await tx.projectAgentWait.findUnique({ where: { id: input.waitId } })
    if (!row) throw new Error(`PROJECT_AGENT_WAIT_NOT_FOUND:${input.waitId}`)
    const followUp = await buildWaitFollowUpFromRow(row as ProjectAgentWaitRow, {
      claimId: input.claimOwner,
      followUpActivityId: input.commandId,
    })
    if (!followUp) throw new Error(`PROJECT_AGENT_WAIT_FOLLOW_UP_INVALID:${input.waitId}`)
    return {
      status: 'claimed',
      followUp,
      projectId: row.projectId,
      userId: row.userId,
      episodeId: row.episodeId,
    }
  })
}

/**
 * Atomically consumes a claimed wait follow-up (claimed -> followed) and
 * returns its details for building the follow-up turn input. Returns null when
 * the claim does not match or the wait was already followed — exactly-once.
 */
export async function startProjectAgentWaitFollowUp(input: {
  runId: string
  waitId: string
  commandId: string
  claimOwner: string
  projectId: string
  userId: string
}): Promise<ProjectAgentWaitFollowUp | null> {
  const rows = await prisma.$queryRaw<ProjectAgentWaitRow[]>`
    SELECT
      id,
      runId,
      activityId,
      projectId,
      userId,
      assistantId,
      scopeRef,
      episodeId,
      operationId,
      taskIds,
      followUpMode,
      status,
      runVersion,
      eventSeq,
      terminalStatus,
      terminalTaskIds,
      failedTaskIds,
      canceledTaskIds,
      followUpKey,
      followUpCommandId,
      claimId,
      claimedAt,
      claimExpiresAt,
      followedAt,
      createdAt,
      resolvedAt
    FROM project_agent_waits
    WHERE id = ${input.waitId}
      AND runId = ${input.runId}
      AND projectId = ${input.projectId}
      AND userId = ${input.userId}
      AND status = 'claimed'
      AND followUpCommandId = ${input.commandId}
      AND claimId = ${input.claimOwner}
      AND followedAt IS NULL
  `
  const row = rows[0]
  if (!row || (row.terminalStatus !== 'completed' && row.terminalStatus !== 'failed') || !row.followUpKey) {
    return null
  }
  if (!row.runId) throw new Error(`PROJECT_AGENT_WAIT_RUN_MISSING:${row.id}`)
  if (!row.activityId) throw new Error(`PROJECT_AGENT_WAIT_ACTIVITY_MISSING:${row.id}`)
  const runFence = createProjectAgentRunFence({
    id: row.runId,
    runVersion: row.runVersion,
    eventSeq: row.eventSeq,
  })
  const wakeupBudgetAvailable = await isProjectAgentRunWakeupBudgetAvailable({
    projectId: input.projectId,
    userId: input.userId,
    runId: input.runId,
  })
  if (!wakeupBudgetAvailable) {
    await appendProjectAgentEvents({
      scope: {
        projectId: row.projectId,
        userId: row.userId,
        episodeId: row.episodeId,
        assistantId: row.assistantId as ProjectAssistantId,
      },
      events: [{
        runFence,
        idempotencyKey: `wait-followed:${row.id}:${input.commandId}:budget-exhausted`,
        event: {
          kind: 'wait.followed',
          runId: row.runId,
          activityId: row.activityId,
          waitId: row.id,
          claimId: input.claimOwner,
          commandId: input.commandId,
          sourceOperationId: row.operationId,
        },
      }, {
        runFence,
        idempotencyKey: `run-failed:${row.runId}:wakeup-budget`,
        event: {
          kind: 'run.failed',
          runId: row.runId,
          stopReason: 'run_budget_exceeded',
          errorCode: 'PROJECT_AGENT_RUN_WAKEUP_BUDGET_EXCEEDED',
          errorMessage: `Project agent wake-up budget exceeded (${PROJECT_AGENT_RUN_WAKEUP_LIMIT}).`,
        },
      }],
    })
    return null
  }
  const followUpActivityId = input.commandId
  await appendProjectAgentEvents({
    scope: {
      projectId: row.projectId,
      userId: row.userId,
      episodeId: row.episodeId,
      assistantId: row.assistantId as ProjectAssistantId,
    },
    events: [
      {
        runFence,
        idempotencyKey: `activity-started:${followUpActivityId}`,
        event: {
          kind: 'activity.started',
          runId: input.runId,
          activityId: followUpActivityId,
          type: 'task_follow_up',
          operationId: null,
          sourceOperationId: row.operationId,
        },
      },
    ],
  })
  return await buildWaitFollowUpFromRow(row, {
    claimId: input.claimOwner,
    followUpActivityId,
  })
}

export async function finalizeProjectAgentWaitFollowUp(input: {
  runId: string
  waitId: string
  commandId: string
  claimOwner: string
  projectId: string
  userId: string
  outcome: 'completed' | 'failed' | 'awaiting_task' | 'awaiting_choice' | 'awaiting_approval'
}): Promise<void> {
  const wait = await prisma.projectAgentWait.findUnique({ where: { id: input.waitId } })
  if (
    !wait
    || wait.runId !== input.runId
    || wait.projectId !== input.projectId
    || wait.userId !== input.userId
    || wait.status !== 'claimed'
    || wait.followUpCommandId !== input.commandId
    || wait.claimId !== input.claimOwner
  ) throw new Error(`PROJECT_AGENT_CONTINUATION_FINALIZE_STALE:${input.waitId}`)
  const run = await prisma.projectAgentRun.findUnique({
    where: { id: input.runId },
    select: { id: true, runVersion: true, eventSeq: true },
  })
  if (!run) throw new Error(`PROJECT_AGENT_RUN_NOT_FOUND:${input.runId}`)
  const terminalRunEvent = input.outcome === 'completed'
    ? {
        runFence: createProjectAgentRunFence(run),
        idempotencyKey: `run-completed:${input.runId}:continuation:${input.commandId}`,
        event: {
          kind: 'run.completed' as const,
          runId: input.runId,
          stopReason: 'completed',
        },
      }
    : input.outcome === 'failed'
      ? {
          runFence: createProjectAgentRunFence(run),
          idempotencyKey: `run-failed:${input.runId}:continuation:${input.commandId}`,
          event: {
            kind: 'run.failed' as const,
            runId: input.runId,
            stopReason: 'tool_error',
            errorCode: 'PROJECT_AGENT_TOOL_ERROR',
            errorMessage: 'Project agent continuation reached a tool error',
          },
        }
      : null
  await appendProjectAgentEvents({
    scope: {
      projectId: wait.projectId,
      userId: wait.userId,
      episodeId: wait.episodeId,
      assistantId: wait.assistantId as ProjectAssistantId,
    },
    events: [{
      runFence: createProjectAgentRunFence(run),
      idempotencyKey: `wait-followed:${wait.id}:${input.commandId}`,
      event: {
        kind: 'wait.followed',
        runId: input.runId,
        activityId: input.commandId,
        waitId: wait.id,
        claimId: input.claimOwner,
        commandId: input.commandId,
        sourceOperationId: wait.operationId,
      },
    }, ...(terminalRunEvent ? [terminalRunEvent] : [])],
  })
}

export async function releaseProjectAgentWaitContinuationClaim(input: {
  waitId: string
  commandId: string
  claimOwner: string
}): Promise<boolean> {
  const released = await prisma.projectAgentWait.updateMany({
    where: {
      id: input.waitId,
      status: 'claimed',
      followUpCommandId: input.commandId,
      claimId: input.claimOwner,
      followedAt: null,
    },
    data: {
      status: 'resolved',
      claimId: null,
      claimedAt: null,
      claimExpiresAt: null,
    },
  })
  return released.count === 1
}

export async function extendProjectAgentWaitContinuationClaim(input: {
  waitId: string
  commandId: string
  claimOwner: string
  claimTtlMs: number
}): Promise<boolean> {
  const extended = await prisma.projectAgentWait.updateMany({
    where: {
      id: input.waitId,
      status: 'claimed',
      followUpCommandId: input.commandId,
      claimId: input.claimOwner,
      followedAt: null,
    },
    data: { claimExpiresAt: new Date(Date.now() + input.claimTtlMs) },
  })
  return extended.count === 1
}
