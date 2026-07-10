import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Prisma } from '@prisma/client'
import type { UIMessage } from 'ai'
import { prisma } from '@/lib/prisma'
import { TASK_EVENT_TYPE, TASK_STATUS, type TaskLifecycleEventType } from '@/lib/task/types'
import type { ProjectAssistantId } from './types'
import {
  appendProjectAssistantThreadMessagesInTransaction,
  buildProjectAssistantScopeRef,
} from './persistence'
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
export type ProjectAgentTaskFollowUpSettlementOutcome =
  | 'completed'
  | 'failed'
  | 'awaiting_task'
  | 'awaiting_choice'
  | 'awaiting_approval'

export interface ProjectAgentContinuationCheckpoint {
  commandId: string
  waitId: string
  runId: string
  outcome: ProjectAgentTaskFollowUpSettlementOutcome
  messageId: string
}

export type ProjectAgentContinuationExecutionStart = 'started' | 'already_started' | 'settled'

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
    const expectedRunVersion = current.followUpCommandId === input.commandId
      ? current.runVersion
      : input.expectedRunVersion
    const expectedEventSeq = current.followUpCommandId === input.commandId
      ? current.eventSeq
      : eventSeq
    const claimed = await tx.projectAgentWait.updateMany({
      where: {
        id: input.waitId,
        runId: input.runId,
        runVersion: expectedRunVersion,
        eventSeq: expectedEventSeq,
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
  const startedRow = await prisma.$transaction(async (tx) => {
    const current = await tx.projectAgentWait.findUnique({ where: { id: input.waitId } })
    if (
      !current
      || current.runId !== input.runId
      || current.projectId !== input.projectId
      || current.userId !== input.userId
      || current.status !== 'claimed'
      || current.followUpCommandId !== input.commandId
      || current.claimId !== input.claimOwner
      || !current.claimExpiresAt
      || current.claimExpiresAt.getTime() <= Date.now()
      || current.followedAt !== null
    ) return null

    const existingActivity = await tx.projectAgentActivity.findUnique({
      where: { id: followUpActivityId },
      select: { runId: true, type: true },
    })
    if (existingActivity) {
      if (existingActivity.runId !== input.runId || existingActivity.type !== 'task_follow_up') {
        throw new Error(`PROJECT_AGENT_CONTINUATION_ACTIVITY_IDENTITY_CONFLICT:${followUpActivityId}`)
      }
      return current as ProjectAgentWaitRow
    }

    const currentFence = createProjectAgentRunFence({
      id: input.runId,
      runVersion: current.runVersion,
      eventSeq: current.eventSeq,
    })
    await appendProjectAgentEventsInTransaction(tx, {
      scope: {
        projectId: current.projectId,
        userId: current.userId,
        episodeId: current.episodeId,
        assistantId: current.assistantId as ProjectAssistantId,
        scopeRef: current.scopeRef,
      },
      events: [{
        runFence: currentFence,
        idempotencyKey: `activity-started:${followUpActivityId}`,
        event: {
          kind: 'activity.started',
          runId: input.runId,
          activityId: followUpActivityId,
          type: 'task_follow_up',
          operationId: null,
          sourceOperationId: current.operationId,
        },
      }],
    })
    const synced = await tx.projectAgentWait.updateMany({
      where: {
        id: current.id,
        status: 'claimed',
        followUpCommandId: input.commandId,
        claimId: input.claimOwner,
        claimExpiresAt: { gt: new Date() },
        runVersion: current.runVersion,
        eventSeq: current.eventSeq,
        followedAt: null,
      },
      data: {
        runVersion: currentFence.runVersion,
        eventSeq: BigInt(currentFence.eventSeq),
      },
    })
    if (synced.count !== 1) {
      throw new Error(`PROJECT_AGENT_CONTINUATION_START_CAS_FAILED:${current.id}:${input.commandId}`)
    }
    return {
      ...current,
      runVersion: currentFence.runVersion,
      eventSeq: BigInt(currentFence.eventSeq),
    } as ProjectAgentWaitRow
  })
  if (!startedRow) return null
  return await buildWaitFollowUpFromRow(startedRow, {
    claimId: input.claimOwner,
    followUpActivityId,
  })
}

function normalizeProjectAgentTaskFollowUpSettlementOutcome(
  value: string,
): ProjectAgentTaskFollowUpSettlementOutcome {
  switch (value) {
    case 'completed':
    case 'failed':
    case 'awaiting_task':
    case 'awaiting_choice':
    case 'awaiting_approval':
      return value
    default:
      throw new Error(`PROJECT_AGENT_CONTINUATION_OUTCOME_INVALID:${value}`)
  }
}

function serializeContinuationMessage(message: UIMessage): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(message)) as Prisma.InputJsonValue
}

export async function loadProjectAgentWaitContinuationCheckpoint(input: {
  waitId: string
  runId: string
  commandId: string
}): Promise<ProjectAgentContinuationCheckpoint | null> {
  const checkpoint = await prisma.projectAgentContinuationCheckpoint.findUnique({
    where: { commandId: input.commandId },
  })
  if (!checkpoint) return null
  if (checkpoint.waitId !== input.waitId || checkpoint.runId !== input.runId) {
    throw new Error(`PROJECT_AGENT_CONTINUATION_CHECKPOINT_IDENTITY_MISMATCH:${input.commandId}`)
  }
  if (checkpoint.status === 'running') return null
  if (
    checkpoint.status !== 'settled'
    || checkpoint.outcome === null
    || checkpoint.messageId === null
    || checkpoint.messageJson === null
  ) throw new Error(`PROJECT_AGENT_CONTINUATION_CHECKPOINT_STATE_INVALID:${input.commandId}`)
  return {
    commandId: checkpoint.commandId,
    waitId: checkpoint.waitId,
    runId: checkpoint.runId,
    outcome: normalizeProjectAgentTaskFollowUpSettlementOutcome(checkpoint.outcome),
    messageId: checkpoint.messageId,
  }
}

export async function beginProjectAgentWaitContinuationExecution(input: {
  runId: string
  waitId: string
  commandId: string
  claimOwner: string
  projectId: string
  userId: string
}): Promise<ProjectAgentContinuationExecutionStart> {
  return await prisma.$transaction(async (tx) => {
    const lockedWait = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM project_agent_waits
      WHERE id = ${input.waitId}
      FOR UPDATE
    `)
    if (lockedWait.length !== 1) {
      throw new Error(`PROJECT_AGENT_CONTINUATION_EXECUTION_STALE:${input.waitId}`)
    }
    const wait = await tx.projectAgentWait.findUnique({ where: { id: input.waitId } })
    if (
      !wait
      || wait.runId !== input.runId
      || wait.projectId !== input.projectId
      || wait.userId !== input.userId
      || wait.status !== 'claimed'
      || wait.followUpCommandId !== input.commandId
      || wait.claimId !== input.claimOwner
      || !wait.claimExpiresAt
      || wait.claimExpiresAt.getTime() <= Date.now()
      || wait.followedAt !== null
    ) throw new Error(`PROJECT_AGENT_CONTINUATION_EXECUTION_STALE:${input.waitId}`)

    const existing = await tx.projectAgentContinuationCheckpoint.findUnique({
      where: { commandId: input.commandId },
    })
    if (existing) {
      if (existing.waitId !== input.waitId || existing.runId !== input.runId) {
        throw new Error(`PROJECT_AGENT_CONTINUATION_CHECKPOINT_IDENTITY_MISMATCH:${input.commandId}`)
      }
      if (existing.status === 'running') return 'already_started'
      if (existing.status === 'settled') return 'settled'
      throw new Error(`PROJECT_AGENT_CONTINUATION_CHECKPOINT_STATE_INVALID:${input.commandId}`)
    }
    const checkpointForWait = await tx.projectAgentContinuationCheckpoint.findUnique({
      where: { waitId: input.waitId },
    })
    if (checkpointForWait) {
      throw new Error(`PROJECT_AGENT_CONTINUATION_WAIT_CHECKPOINT_CONFLICT:${input.waitId}`)
    }
    await tx.projectAgentContinuationCheckpoint.create({
      data: {
        commandId: input.commandId,
        waitId: input.waitId,
        runId: input.runId,
        status: 'running',
      },
    })
    return 'started'
  })
}

export async function checkpointProjectAgentWaitFollowUp(input: {
  runId: string
  waitId: string
  commandId: string
  claimOwner: string
  projectId: string
  userId: string
  outcome: ProjectAgentTaskFollowUpSettlementOutcome
  message: UIMessage
}): Promise<ProjectAgentContinuationCheckpoint> {
  if (!input.message.id.trim()) throw new Error('PROJECT_AGENT_CONTINUATION_MESSAGE_ID_REQUIRED')
  const messageJson = serializeContinuationMessage(input.message)
  return await prisma.$transaction(async (tx) => {
    const lockedWait = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM project_agent_waits
      WHERE id = ${input.waitId}
      FOR UPDATE
    `)
    if (lockedWait.length !== 1) {
      throw new Error(`PROJECT_AGENT_CONTINUATION_CHECKPOINT_STALE:${input.waitId}`)
    }
    const wait = await tx.projectAgentWait.findUnique({ where: { id: input.waitId } })
    if (
      !wait
      || wait.runId !== input.runId
      || wait.projectId !== input.projectId
      || wait.userId !== input.userId
      || wait.status !== 'claimed'
      || wait.followUpCommandId !== input.commandId
      || wait.claimId !== input.claimOwner
      || !wait.claimExpiresAt
      || wait.claimExpiresAt.getTime() <= Date.now()
      || wait.followedAt !== null
    ) throw new Error(`PROJECT_AGENT_CONTINUATION_CHECKPOINT_STALE:${input.waitId}`)

    const existing = await tx.projectAgentContinuationCheckpoint.findUnique({
      where: { commandId: input.commandId },
    })
    if (!existing) {
      throw new Error(`PROJECT_AGENT_CONTINUATION_EXECUTION_NOT_STARTED:${input.commandId}`)
    }
    if (existing.waitId !== input.waitId || existing.runId !== input.runId) {
      throw new Error(`PROJECT_AGENT_CONTINUATION_CHECKPOINT_IDENTITY_MISMATCH:${input.commandId}`)
    }
    if (existing.status === 'settled') {
      if (
        existing.outcome !== input.outcome
        || existing.messageId !== input.message.id
        || !isDeepStrictEqual(existing.messageJson, messageJson)
      ) throw new Error(`PROJECT_AGENT_CONTINUATION_CHECKPOINT_CONFLICT:${input.commandId}`)
      return {
        commandId: existing.commandId,
        waitId: existing.waitId,
        runId: existing.runId,
        outcome: normalizeProjectAgentTaskFollowUpSettlementOutcome(existing.outcome),
        messageId: existing.messageId,
      }
    }
    if (existing.status !== 'running') {
      throw new Error(`PROJECT_AGENT_CONTINUATION_CHECKPOINT_STATE_INVALID:${input.commandId}`)
    }

    await appendProjectAssistantThreadMessagesInTransaction(tx, {
      projectId: wait.projectId,
      userId: wait.userId,
      episodeId: wait.episodeId,
      assistantId: wait.assistantId as ProjectAssistantId,
      messages: [input.message],
    })
    const updated = await tx.projectAgentContinuationCheckpoint.updateMany({
      where: {
        commandId: input.commandId,
        waitId: input.waitId,
        runId: input.runId,
        status: 'running',
      },
      data: {
        status: 'settled',
        outcome: input.outcome,
        messageId: input.message.id,
        messageJson,
        completedAt: new Date(),
      },
    })
    if (updated.count !== 1) {
      throw new Error(`PROJECT_AGENT_CONTINUATION_CHECKPOINT_CAS_FAILED:${input.commandId}`)
    }
    return {
      commandId: input.commandId,
      waitId: input.waitId,
      runId: input.runId,
      outcome: input.outcome,
      messageId: input.message.id,
    }
  })
}

export async function finalizeProjectAgentWaitFollowUp(input: {
  runId: string
  waitId: string
  commandId: string
  claimOwner: string
  projectId: string
  userId: string
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const wait = await tx.projectAgentWait.findUnique({ where: { id: input.waitId } })
    if (
      !wait
      || wait.runId !== input.runId
      || wait.projectId !== input.projectId
      || wait.userId !== input.userId
      || wait.status !== 'claimed'
      || wait.followUpCommandId !== input.commandId
      || wait.claimId !== input.claimOwner
      || !wait.claimExpiresAt
      || wait.claimExpiresAt.getTime() <= Date.now()
    ) throw new Error(`PROJECT_AGENT_CONTINUATION_FINALIZE_STALE:${input.waitId}`)
    const checkpoint = await tx.projectAgentContinuationCheckpoint.findUnique({
      where: { commandId: input.commandId },
    })
    if (
      !checkpoint
      || checkpoint.waitId !== wait.id
      || checkpoint.runId !== input.runId
      || checkpoint.status !== 'settled'
      || checkpoint.outcome === null
      || checkpoint.messageId === null
      || checkpoint.messageJson === null
    ) {
      throw new Error(`PROJECT_AGENT_CONTINUATION_CHECKPOINT_MISSING:${input.commandId}`)
    }
    const outcome = normalizeProjectAgentTaskFollowUpSettlementOutcome(checkpoint.outcome)
    const run = await tx.projectAgentRun.findUnique({
      where: { id: input.runId },
      select: { id: true, runVersion: true, eventSeq: true },
    })
    if (!run) throw new Error(`PROJECT_AGENT_RUN_NOT_FOUND:${input.runId}`)
    const runFence = createProjectAgentRunFence(run)
    const activityEvent = outcome === 'failed'
      ? {
          runFence,
          idempotencyKey: `activity-failed:${input.commandId}:continuation`,
          event: {
            kind: 'activity.failed' as const,
            runId: input.runId,
            activityId: input.commandId,
            errorCode: 'PROJECT_AGENT_TASK_FOLLOW_UP_FAILED',
            errorMessage: 'Project agent continuation reached a tool error',
          },
        }
      : {
          runFence,
          idempotencyKey: `activity-completed:${input.commandId}:continuation`,
          event: {
            kind: 'activity.completed' as const,
            runId: input.runId,
            activityId: input.commandId,
          },
        }
    const terminalRunEvent = outcome === 'completed'
      ? {
          runFence,
          idempotencyKey: `run-completed:${input.runId}:continuation:${input.commandId}`,
          event: {
            kind: 'run.completed' as const,
            runId: input.runId,
            stopReason: 'completed',
          },
        }
      : outcome === 'failed'
        ? {
            runFence,
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
    await appendProjectAgentEventsInTransaction(tx, {
      scope: {
        projectId: wait.projectId,
        userId: wait.userId,
        episodeId: wait.episodeId,
        assistantId: wait.assistantId as ProjectAssistantId,
        scopeRef: wait.scopeRef,
      },
      events: [activityEvent, {
        runFence,
        idempotencyKey: `wait-followed:${wait.id}:${input.commandId}`,
        event: {
          kind: 'wait.followed' as const,
          runId: input.runId,
          activityId: input.commandId,
          waitId: wait.id,
          claimId: input.claimOwner,
          commandId: input.commandId,
          sourceOperationId: wait.operationId,
        },
      }, ...(terminalRunEvent ? [terminalRunEvent] : [])],
    })
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
