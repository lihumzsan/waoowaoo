import { createHash, randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { TASK_EVENT_TYPE, TASK_STATUS, type TaskLifecycleEventType } from '@/lib/task/types'
import type { ProjectAssistantId } from './types'
import { buildProjectAssistantScopeRef } from './persistence'
import { appendProjectAgentEvents } from './event'

export type ProjectAgentWaitStatus = 'pending' | 'resolved' | 'claimed' | 'followed'
export type ProjectAgentWaitTerminalStatus = 'completed' | 'failed'

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
  terminalStatus: string | null
  terminalTaskIds: unknown | null
  failedTaskIds: unknown | null
  followUpKey: string | null
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
  operationId: string
  taskIds: string[]
  failedTaskIds: string[]
  failedTasks: ProjectAgentWaitFailedTask[]
  terminalStatus: ProjectAgentWaitTerminalStatus
  total: number
  successCount: number
  failedCount: number
  claimId: string
}

export interface ProjectAgentSessionWait {
  runId: string | null
  activityId: string | null
  waitId: string
  operationId: string
  taskIds: string[]
  failedTaskIds: string[]
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
}): string {
  return createHash('sha256').update(JSON.stringify({
    terminalTaskIds: normalizeTaskIds(input.terminalTaskIds),
    failedTaskIds: normalizeTaskIds(input.failedTaskIds),
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
}): string {
  const hash = hashWaitTerminalTaskState({
    terminalTaskIds: input.terminalTaskIds,
    failedTaskIds: input.failedTaskIds,
  })
  return enforceProjectAgentEventIdempotencyKeyLimit(`task-progressed:${input.waitId}:${hash}`)
}

export function buildProjectAgentTaskTerminalIdempotencyKey(input: {
  waitId: string
  terminalStatus: ProjectAgentWaitTerminalStatus
  terminalTaskIds: string[]
  failedTaskIds: string[]
}): string {
  const hash = hashWaitTerminalTaskState({
    terminalTaskIds: input.terminalTaskIds,
    failedTaskIds: input.failedTaskIds,
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
  if (row.terminalStatus !== 'completed' && row.terminalStatus !== 'failed') return null
  if (!row.followUpKey) return null
  const taskIds = parseStringArray(row.taskIds)
  const failedTaskIds = parseStringArray(row.failedTaskIds)
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
    operationId: row.operationId,
    taskIds,
    failedTaskIds,
    failedTasks,
    terminalStatus: row.terminalStatus,
    total: taskIds.length,
    successCount: Math.max(taskIds.length - failedTaskIds.length, 0),
    failedCount: failedTaskIds.length,
    claimId: params.claimId ?? row.claimId ?? '',
  }
}

function readTerminalLifecycleTypeFromTaskStatus(status: string): TaskLifecycleEventType | null {
  if (status === TASK_STATUS.COMPLETED) return TASK_EVENT_TYPE.COMPLETED
  if (status === TASK_STATUS.FAILED || status === TASK_STATUS.CANCELED) return TASK_EVENT_TYPE.FAILED
  return null
}

export function applyProjectAgentWaitTaskSnapshot(input: {
  taskIds: string[]
  tasks: ProjectAgentWaitTaskSnapshot[]
}): ApplyProjectAgentWaitTerminalEventResult {
  const taskIds = normalizeTaskIds(input.taskIds)
  let terminalTaskIds: string[] = []
  let failedTaskIds: string[] = []
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
    })
    terminalTaskIds = result.terminalTaskIds
    failedTaskIds = result.failedTaskIds
    terminalStatus = result.terminalStatus
  }

  return {
    terminalTaskIds,
    failedTaskIds,
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
  if (value === 'completed' || value === 'failed') return value
  throw new Error(`PROJECT_AGENT_WAIT_TERMINAL_STATUS_INVALID:${value}`)
}

export async function createProjectAgentWait(input: CreateProjectAgentWaitInput): Promise<string | null> {
  const taskIds = normalizeTaskIds(input.taskIds)
  if (taskIds.length === 0) return null
  const waitId = randomUUID()
  const activityId = randomUUID()
  await appendProjectAgentEvents({
    scope: input,
    events: [
      {
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
  await resolveNewProjectAgentWaitFromCurrentTasks({
    waitId,
    runId: input.runId,
    activityId,
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId ?? null,
    assistantId: input.assistantId ?? 'workspace-command',
    taskIds,
    followUpMode: input.followUpMode,
  })
  return waitId
}

export interface ApplyProjectAgentWaitTerminalEventInput {
  taskId: string
  lifecycleType: TaskLifecycleEventType
  taskIds: string[]
  terminalTaskIds: string[]
  failedTaskIds: string[]
}

export interface ApplyProjectAgentWaitTerminalEventResult {
  terminalTaskIds: string[]
  failedTaskIds: string[]
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
      terminalStatus: null,
    }
  }

  const terminalTaskIds = normalizeTaskIds([...input.terminalTaskIds, input.taskId])
  const failedTaskIds = input.lifecycleType === TASK_EVENT_TYPE.FAILED
    ? normalizeTaskIds([...input.failedTaskIds, input.taskId])
    : normalizeTaskIds(input.failedTaskIds)
  const allTerminal = taskIds.every((taskId) => terminalTaskIds.includes(taskId))

  return {
    terminalTaskIds,
    failedTaskIds,
    terminalStatus: allTerminal ? (failedTaskIds.length > 0 ? 'failed' : 'completed') : null,
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
  runId?: string | null
  activityId: string
  projectId: string
  userId: string
  episodeId?: string | null
  assistantId?: ProjectAssistantId
  followUpMode: string
  terminalStatus: ProjectAgentWaitTerminalStatus
  terminalTaskIds: string[]
  failedTaskIds: string[]
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
      idempotencyKey: buildProjectAgentTaskTerminalIdempotencyKey({
        waitId: input.waitId,
        terminalStatus: input.terminalStatus,
        terminalTaskIds: input.terminalTaskIds,
        failedTaskIds: input.failedTaskIds,
      }),
      event: {
        kind: 'task.terminal',
        runId: input.runId ?? null,
        activityId: input.activityId,
        waitId: input.waitId,
        terminalStatus: input.terminalStatus,
        terminalTaskIds: input.terminalTaskIds,
        failedTaskIds: input.failedTaskIds,
        nextActivityId,
      },
    }],
  })
}

async function resolveNewProjectAgentWaitFromCurrentTasks(input: {
  waitId: string
  runId?: string | null
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
  if (result.terminalTaskIds.length === 0 && result.failedTaskIds.length === 0) return

  if (!result.terminalStatus) {
    await appendProjectAgentEvents({
      scope: input,
      events: [{
        idempotencyKey: buildProjectAgentTaskProgressedIdempotencyKey({
          waitId: input.waitId,
          terminalTaskIds: result.terminalTaskIds,
          failedTaskIds: result.failedTaskIds,
        }),
        event: {
          kind: 'task.progressed',
          runId: input.runId ?? null,
          activityId: input.activityId,
          waitId: input.waitId,
          terminalTaskIds: result.terminalTaskIds,
          failedTaskIds: result.failedTaskIds,
        },
      }],
    })
    return
  }

  await applyWaitTerminalStatus({
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
  })
}

export async function resolveProjectAgentWaitsForTaskEvent(input: {
  taskId: string
  projectId: string
  userId: string
  lifecycleType: TaskLifecycleEventType
}): Promise<void> {
  if (input.lifecycleType !== TASK_EVENT_TYPE.COMPLETED && input.lifecycleType !== TASK_EVENT_TYPE.FAILED) return

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
      terminalStatus,
      terminalTaskIds,
      failedTaskIds,
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
  `

  for (const row of rows) {
    if (!row.activityId) throw new Error(`PROJECT_AGENT_WAIT_ACTIVITY_MISSING:${row.id}`)
    const result = applyProjectAgentWaitTerminalEvent({
      taskId: input.taskId,
      lifecycleType: input.lifecycleType,
      taskIds: parseStringArray(row.taskIds),
      terminalTaskIds: parseStringArray(row.terminalTaskIds),
      failedTaskIds: parseStringArray(row.failedTaskIds),
    })

    if (!result.terminalStatus) {
      await appendProjectAgentEvents({
        scope: {
          projectId: row.projectId,
          userId: row.userId,
          episodeId: row.episodeId,
          assistantId: row.assistantId as ProjectAssistantId,
        },
        events: [{
          idempotencyKey: buildProjectAgentTaskProgressedIdempotencyKey({
            waitId: row.id,
            terminalTaskIds: result.terminalTaskIds,
            failedTaskIds: result.failedTaskIds,
          }),
          event: {
            kind: 'task.progressed',
            runId: row.runId,
            activityId: row.activityId,
            waitId: row.id,
            terminalTaskIds: result.terminalTaskIds,
            failedTaskIds: result.failedTaskIds,
          },
        }],
      })
      continue
    }

    await applyWaitTerminalStatus({
      waitId: row.id,
      runId: row.runId,
      activityId: row.activityId,
      projectId: row.projectId,
      userId: row.userId,
      episodeId: row.episodeId,
      assistantId: row.assistantId as ProjectAssistantId,
      followUpMode: row.followUpMode,
      terminalStatus: result.terminalStatus,
      terminalTaskIds: result.terminalTaskIds,
      failedTaskIds: result.failedTaskIds,
    })
  }
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
      terminalStatus,
      terminalTaskIds,
      failedTaskIds,
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
    if (!row.activityId) throw new Error(`PROJECT_AGENT_WAIT_ACTIVITY_MISSING:${row.id}`)
    await resolveNewProjectAgentWaitFromCurrentTasks({
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
  await reconcilePendingProjectAgentWaitsForScope(input)
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
      status,
      terminalStatus,
      terminalTaskIds,
      failedTaskIds,
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
  await reconcilePendingProjectAgentWaitsForScope(input)
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
      terminalStatus,
      terminalTaskIds,
      failedTaskIds,
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
    return {
      runId: row.runId,
      activityId: row.activityId,
      waitId: row.id,
      operationId: row.operationId,
      taskIds,
      failedTaskIds,
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
}): Promise<ProjectAgentWaitFollowUp[]> {
  await reconcilePendingProjectAgentWaitsForScope(input)
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
      status,
      terminalStatus,
      terminalTaskIds,
      failedTaskIds,
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

/**
 * Atomically consumes a claimed wait follow-up (claimed -> followed) and
 * returns its details for building the follow-up turn input. Returns null when
 * the claim does not match or the wait was already followed — exactly-once.
 */
export async function consumeProjectAgentWaitFollowUp(input: {
  runId: string
  waitId: string
  claimId: string
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
      terminalStatus,
      terminalTaskIds,
      failedTaskIds,
      followUpKey,
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
      AND claimId = ${input.claimId}
      AND followedAt IS NULL
  `
  const row = rows[0]
  if (!row || (row.terminalStatus !== 'completed' && row.terminalStatus !== 'failed') || !row.followUpKey) {
    return null
  }
  const followUpActivityId = randomUUID()
  await appendProjectAgentEvents({
    scope: {
      projectId: row.projectId,
      userId: row.userId,
      episodeId: row.episodeId,
      assistantId: row.assistantId as ProjectAssistantId,
    },
    events: [
      {
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
      {
        idempotencyKey: `wait-followed:${row.id}:${input.claimId}`,
        event: {
          kind: 'wait.followed',
          runId: input.runId,
          activityId: followUpActivityId,
          waitId: row.id,
          claimId: input.claimId,
          sourceOperationId: row.operationId,
        },
      },
    ],
  })
  return await buildWaitFollowUpFromRow(row, {
    claimId: input.claimId,
    followUpActivityId,
  })
}
