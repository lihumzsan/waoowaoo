import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  isTaskType,
  TASK_EVENT_TYPE,
  TASK_STATUS,
  type TaskLifecycleEventType,
} from '@/lib/task/types'
import { projectTaskContinuationResult } from '@/lib/task/result-projection'
import type { ProjectAssistantId } from './types'
import type { ProjectAgentTaskSubmissionReceipt } from '@/lib/operations/types'
import type { ProjectAgentOperationBatchIdentity } from './operation-batch'
import { buildProjectAssistantScopeRef } from './persistence'
import { appendProjectAgentEventsInTransaction } from './event'
import { createOutboxCommandInTransaction } from '@/lib/outbox/repository'
import { OUTBOX_COMMAND_KIND } from '@/lib/outbox/types'
import {
  createProjectAgentRunFence,
  assignProjectAgentRunFence,
  type ProjectAgentRunFence,
} from './run-fence'
import {
  prepareProjectAgentOperationBatchHandoffInTransaction,
  settleProjectAgentOperationBatchHandoffInTransaction,
} from './execution-handoff'
import {
  createProjectAgentExecutionSegment,
  projectAgentExecutionStartedIdempotencyKey,
} from './execution-segment'

export type ProjectAgentWaitStatus = 'collecting' | 'pending' | 'resolved' | 'claimed' | 'followed' | 'abandoned'
export type ProjectAgentWaitTerminalStatus = 'completed' | 'failed' | 'canceled'
export type ProjectAgentTaskFollowUpSettlementOutcome =
  | 'completed'
  | 'failed'
  | 'outcome_unknown'
  | 'delivery_exhausted'
  | 'awaiting_choice'
  | 'awaiting_approval'

export type ProjectAgentContinuationExecutionStart = 'started' | 'already_started' | 'settled'

/**
 * What happens when every task behind the wait reaches a terminal state.
 * - resume_agent: the wait becomes claimable and the agent is woken with a follow-up turn.
 * OperationBatch always uses resume_agent; terminal success, failure and
 * cancellation all become one claimable continuation.
 */
export type ProjectAgentWaitFollowUpMode = 'resume_agent'

interface ProjectAgentWaitScopeInput {
  projectId: string
  userId: string
  episodeId?: string | null
  assistantId?: ProjectAssistantId
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

interface ProjectAgentWaitCompletedTaskRow {
  id: string
  type: string | null
  targetType: string | null
  targetId: string | null
  result: unknown
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

export interface ProjectAgentWaitCompletedTask {
  taskId: string
  taskType: string | null
  targetType: string | null
  targetId: string | null
  result: Record<string, unknown> | null
}

export interface ProjectAgentWaitFollowUp {
  runId: string | null
  activityId: string | null
  waitId: string
  followUpKey: string
  followUpMode: ProjectAgentWaitFollowUpMode
  operationId: string
  taskIds: string[]
  failedTaskIds: string[]
  canceledTaskIds: string[]
  failedTasks: ProjectAgentWaitFailedTask[]
  completedTasks: ProjectAgentWaitCompletedTask[]
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

function readResultRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

async function readCompletedTaskDetails(input: {
  projectId: string
  userId: string
  completedTaskIds: string[]
}): Promise<ProjectAgentWaitCompletedTask[]> {
  const completedTaskIds = normalizeTaskIds(input.completedTaskIds)
  if (completedTaskIds.length === 0) return []
  const rows = await prisma.$queryRaw<ProjectAgentWaitCompletedTaskRow[]>(Prisma.sql`
    SELECT id, type, targetType, targetId, result
    FROM tasks
    WHERE projectId = ${input.projectId}
      AND userId = ${input.userId}
      AND status = ${TASK_STATUS.COMPLETED}
      AND id IN (${Prisma.join(completedTaskIds)})
  `)
  const rowById = new Map(rows.map((row) => [row.id, row]))
  return completedTaskIds.map((taskId) => {
    const row = rowById.get(taskId)
    if (!row) throw new Error(`PROJECT_AGENT_WAIT_COMPLETED_TASK_MISSING:${taskId}`)
    if (!row.type || !isTaskType(row.type)) {
      throw new Error(`PROJECT_AGENT_WAIT_COMPLETED_TASK_TYPE_INVALID:${taskId}:${String(row.type)}`)
    }
    return {
      taskId,
      taskType: row.type,
      targetType: row.targetType,
      targetId: row.targetId,
      result: projectTaskContinuationResult(row.type, readResultRecord(row.result)),
    }
  })
}

async function buildWaitFollowUpFromRow(
  row: ProjectAgentWaitRow,
  params: {
    claimId?: string | null
  },
): Promise<ProjectAgentWaitFollowUp | null> {
  if (row.terminalStatus !== 'completed' && row.terminalStatus !== 'failed' && row.terminalStatus !== 'canceled') return null
  if (!row.followUpKey) return null
  const taskIds = parseStringArray(row.taskIds)
  const failedTaskIds = parseStringArray(row.failedTaskIds)
  const canceledTaskIds = parseStringArray(row.canceledTaskIds)
  const excludedTaskIds = new Set([...failedTaskIds, ...canceledTaskIds])
  const completedTaskIds = taskIds.filter((taskId) => !excludedTaskIds.has(taskId))
  const failedTasks = await readFailedTaskDetails({
    projectId: row.projectId,
    userId: row.userId,
    failedTaskIds,
  })
  const completedTasks = await readCompletedTaskDetails({
    projectId: row.projectId,
    userId: row.userId,
    completedTaskIds,
  })
  return {
    runId: row.runId,
    activityId: row.activityId,
    waitId: row.id,
    followUpKey: row.followUpKey,
    followUpMode: normalizeWaitFollowUpMode(row.followUpMode),
    operationId: row.operationId,
    taskIds,
    failedTaskIds,
    canceledTaskIds,
    failedTasks,
    completedTasks,
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
  if (value === 'resume_agent') return value
  throw new Error(`PROJECT_AGENT_WAIT_FOLLOW_UP_MODE_INVALID:${value}`)
}

function normalizeWaitStatus(value: string): ProjectAgentWaitStatus {
  if (
    value === 'collecting'
    || value === 'pending'
    || value === 'resolved'
    || value === 'claimed'
    || value === 'followed'
    || value === 'abandoned'
  ) return value
  throw new Error(`PROJECT_AGENT_WAIT_STATUS_INVALID:${value}`)
}

async function lockCurrentRunFenceInTransaction(
  tx: Prisma.TransactionClient,
  runId: string,
): Promise<ProjectAgentRunFence> {
  const rows = await tx.$queryRaw<Array<{ id: string; runVersion: number; eventSeq: bigint }>>(Prisma.sql`
    SELECT id, runVersion, eventSeq
    FROM project_agent_runs
    WHERE id = ${runId}
    FOR UPDATE
  `)
  const row = rows[0]
  if (!row) throw new Error(`PROJECT_AGENT_RUN_NOT_FOUND:${runId}`)
  return createProjectAgentRunFence(row)
}

export async function refreshProjectAgentRunFence(runFence: ProjectAgentRunFence): Promise<void> {
  const current = await prisma.$transaction(async (tx) => lockCurrentRunFenceInTransaction(tx, runFence.runId))
  assignProjectAgentRunFence(runFence, current)
}

export interface BindProjectAgentOperationBatchMemberResult {
  receipt: ProjectAgentTaskSubmissionReceipt
  backgroundRunFence: ProjectAgentRunFence
}

export async function bindProjectAgentOperationBatchWaitMemberInTransaction(
  tx: Prisma.TransactionClient,
  input: ProjectAgentWaitScopeInput & {
    batch: ProjectAgentOperationBatchIdentity
    backgroundRunFence: ProjectAgentRunFence
    locale?: string | null
    operationId: string
    toolCallId: string
    taskIds: readonly string[]
  },
): Promise<BindProjectAgentOperationBatchMemberResult> {
  const operationId = input.operationId.trim()
  const toolCallId = input.toolCallId.trim()
  const taskIds = normalizeTaskIds([...input.taskIds])
  if (!operationId) throw new Error('PROJECT_AGENT_OPERATION_BATCH_OPERATION_REQUIRED')
  if (!toolCallId) throw new Error(`PROJECT_AGENT_OPERATION_BATCH_TOOL_CALL_REQUIRED:${operationId}`)
  if (taskIds.length === 0) throw new Error(`PROJECT_AGENT_OPERATION_BATCH_TASKS_EMPTY:${toolCallId}`)
  if (input.backgroundRunFence.runId !== input.batch.backgroundRunId) {
    throw new Error(`PROJECT_AGENT_OPERATION_BATCH_RUN_FENCE_MISMATCH:${input.batch.batchId}`)
  }
  const tasks = await tx.$queryRaw<ProjectAgentWaitTaskSnapshot[]>(Prisma.sql`
    SELECT id, status
    FROM tasks
    WHERE projectId = ${input.projectId}
      AND userId = ${input.userId}
      AND id IN (${Prisma.join(taskIds)})
    FOR UPDATE
  `)
  const taskIdSet = new Set(tasks.map((task) => task.id))
  const missingTaskIds = taskIds.filter((taskId) => !taskIdSet.has(taskId))
  if (missingTaskIds.length > 0) {
    throw new Error(`PROJECT_AGENT_OPERATION_BATCH_TASK_NOT_FOUND:${missingTaskIds.join(',')}`)
  }
  const waits = await tx.$queryRaw<Array<{
    id: string
    runId: string | null
    activityId: string | null
    operationId: string
    taskIds: unknown
    status: string
  }>>(Prisma.sql`
    SELECT id, runId, activityId, operationId, taskIds, status
    FROM project_agent_waits
    WHERE id = ${input.batch.waitId}
    FOR UPDATE
  `)
  const existingWait = waits[0] ?? null
  if (
    existingWait
    && (
      existingWait.runId !== input.batch.backgroundRunId
      || existingWait.activityId !== input.batch.activityId
      || existingWait.operationId !== input.batch.primaryOperationId
      || existingWait.status !== 'collecting'
    )
  ) {
    throw new Error(`PROJECT_AGENT_OPERATION_BATCH_WAIT_IDENTITY_CONFLICT:${input.batch.batchId}`)
  }
  const aggregateTaskIds = normalizeTaskIds([
    ...(existingWait ? parseStringArray(existingWait.taskIds) : []),
    ...taskIds,
  ])
  const { assistantId, scopeRef } = buildWaitScope(input)
  const memberKey = createHash('sha256').update(toolCallId).digest('hex').slice(0, 32)
  await appendProjectAgentEventsInTransaction(tx, {
    scope: {
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId ?? null,
      assistantId,
      scopeRef,
    },
    events: [
      ...(!existingWait
        ? [{
            runFence: input.backgroundRunFence,
            idempotencyKey: `run-started:${input.batch.backgroundRunId}`,
            event: {
              kind: 'run.started' as const,
              runId: input.batch.backgroundRunId,
              requestId: `operation-batch:${input.batch.batchId}`,
              controlKind: 'task_follow_up' as const,
            },
          }, {
            runFence: input.backgroundRunFence,
            idempotencyKey: `activity-started:${input.batch.activityId}`,
            event: {
              kind: 'activity.started' as const,
              runId: input.batch.backgroundRunId,
              activityId: input.batch.activityId,
              type: 'waiting_task' as const,
              operationId: input.batch.primaryOperationId,
            },
          }, {
            runFence: input.backgroundRunFence,
            idempotencyKey: `task-collection-started:${input.batch.waitId}`,
            event: {
              kind: 'task.collection_started' as const,
              runId: input.batch.backgroundRunId,
              activityId: input.batch.activityId,
              waitId: input.batch.waitId,
              operationId: input.batch.primaryOperationId,
              followUpMode: 'resume_agent' as const,
            },
          }]
        : []),
      {
        runFence: input.backgroundRunFence,
        idempotencyKey: `task-collection-member:${input.batch.waitId}:${memberKey}`,
        event: {
          kind: 'task.collection_member_bound' as const,
          runId: input.batch.backgroundRunId,
          activityId: input.batch.activityId,
          waitId: input.batch.waitId,
          operationId: input.batch.primaryOperationId,
          memberOperationId: operationId,
          toolCallId,
          taskIds: aggregateTaskIds,
          followUpMode: 'resume_agent' as const,
        },
      },
    ],
  })
  await prepareProjectAgentOperationBatchHandoffInTransaction(tx, {
    batchId: input.batch.batchId,
    originRunId: input.batch.originRunId,
    backgroundRunId: input.batch.backgroundRunId,
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId ?? null,
    locale: input.locale ?? null,
    assistantId,
    operationId: input.batch.primaryOperationId,
    waitId: input.batch.waitId,
    activityId: input.batch.activityId,
    taskIds: aggregateTaskIds,
  })
  return {
    receipt: {
      kind: 'task_submission',
      batchId: input.batch.batchId,
      backgroundRunId: input.batch.backgroundRunId,
      waitId: input.batch.waitId,
      operationId,
      taskIds,
    },
    backgroundRunFence: input.backgroundRunFence,
  }
}

export async function sealProjectAgentOperationBatchWait(input: ProjectAgentWaitScopeInput & {
  batch: ProjectAgentOperationBatchIdentity
  taskIds: readonly string[]
}): Promise<void> {
  const taskIds = normalizeTaskIds([...input.taskIds])
  if (taskIds.length === 0) throw new Error(`PROJECT_AGENT_OPERATION_BATCH_TASKS_EMPTY:${input.batch.batchId}`)
  await prisma.$transaction(async (tx) => {
    const waits = await tx.$queryRaw<Array<{
      id: string
      runId: string | null
      activityId: string | null
      operationId: string
      taskIds: unknown
      status: string
    }>>(Prisma.sql`
      SELECT id, runId, activityId, operationId, taskIds, status
      FROM project_agent_waits
      WHERE id = ${input.batch.waitId}
      FOR UPDATE
    `)
    const wait = waits[0]
    if (!wait) throw new Error(`PROJECT_AGENT_OPERATION_BATCH_WAIT_NOT_FOUND:${input.batch.batchId}`)
    const storedTaskIds = parseStringArray(wait.taskIds)
    if (
      wait.runId !== input.batch.backgroundRunId
      || wait.activityId !== input.batch.activityId
      || wait.operationId !== input.batch.primaryOperationId
      || JSON.stringify(storedTaskIds) !== JSON.stringify(taskIds)
    ) {
      throw new Error(`PROJECT_AGENT_OPERATION_BATCH_WAIT_IDENTITY_CONFLICT:${input.batch.batchId}`)
    }
    if (wait.status === 'pending') return
    if (wait.status !== 'collecting') {
      throw new Error(`PROJECT_AGENT_OPERATION_BATCH_WAIT_NOT_COLLECTING:${input.batch.batchId}:${wait.status}`)
    }
    const runFence = await lockCurrentRunFenceInTransaction(tx, input.batch.backgroundRunId)
    const { assistantId, scopeRef } = buildWaitScope(input)
    await appendProjectAgentEventsInTransaction(tx, {
      scope: {
        projectId: input.projectId,
        userId: input.userId,
        episodeId: input.episodeId ?? null,
        assistantId,
        scopeRef,
      },
      events: [{
        runFence,
        idempotencyKey: `task-collection-sealed:${input.batch.waitId}`,
        event: {
          kind: 'task.collection_sealed',
          runId: input.batch.backgroundRunId,
          activityId: input.batch.activityId,
          waitId: input.batch.waitId,
          operationId: input.batch.primaryOperationId,
          taskIds,
          followUpMode: 'resume_agent',
        },
      }],
    })
    await settleProjectAgentOperationBatchHandoffInTransaction(tx, {
      batchId: input.batch.batchId,
      originRunId: input.batch.originRunId,
      backgroundRunId: input.batch.backgroundRunId,
      waitId: input.batch.waitId,
      activityId: input.batch.activityId,
      taskIds,
    })
    const tasks = await tx.$queryRaw<ProjectAgentWaitTaskSnapshot[]>(Prisma.sql`
      SELECT id, status
      FROM tasks
      WHERE projectId = ${input.projectId}
        AND userId = ${input.userId}
        AND id IN (${Prisma.join(taskIds)})
      FOR UPDATE
    `)
    if (tasks.length !== taskIds.length) {
      throw new Error(`PROJECT_AGENT_OPERATION_BATCH_TASK_IDENTITY_CHANGED:${input.batch.batchId}`)
    }
    for (const task of tasks) {
      const terminalType = readTerminalLifecycleTypeFromTaskStatus(task.status)
      if (!terminalType) continue
      await resolveProjectAgentWaitsForTaskTerminalInTransaction(tx, {
        taskId: task.id,
        projectId: input.projectId,
        userId: input.userId,
        lifecycleType: terminalType,
      })
    }
  })
}

function normalizeWaitTerminalStatus(value: string | null): ProjectAgentWaitTerminalStatus | null {
  if (value === null) return null
  if (value === 'completed' || value === 'failed' || value === 'canceled') return value
  throw new Error(`PROJECT_AGENT_WAIT_TERMINAL_STATUS_INVALID:${value}`)
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

/** Every aggregate terminal becomes claimable for exactly one continuation. */
export function resolveWaitTerminalNextStatus(params: {
  followUpMode: string
  terminalStatus: ProjectAgentWaitTerminalStatus
}): Extract<ProjectAgentWaitStatus, 'resolved' | 'followed'> {
  if (params.followUpMode !== 'resume_agent') {
    throw new Error(`PROJECT_AGENT_WAIT_FOLLOW_UP_MODE_INVALID:${params.followUpMode}`)
  }
  return 'resolved'
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
    const result = applyProjectAgentWaitTerminalEvent({
      taskId: input.taskId,
      lifecycleType: input.lifecycleType,
      taskIds,
      terminalTaskIds: parseStringArray(row.terminalTaskIds),
      failedTaskIds: parseStringArray(row.failedTaskIds),
      canceledTaskIds: parseStringArray(row.canceledTaskIds),
    })
    if (result.terminalTaskIds.length === 0) continue
    const currentRuns = await tx.$queryRaw<Array<{ id: string; runVersion: number; eventSeq: bigint }>>(Prisma.sql`
      SELECT id, runVersion, eventSeq
      FROM project_agent_runs
      WHERE id = ${row.runId}
      FOR UPDATE
    `)
    const currentRun = currentRuns[0]
    if (!currentRun) throw new Error(`PROJECT_AGENT_RUN_NOT_FOUND:${row.runId}`)
    /*
     * The watermark stored on the Wait is an audit of the last Wait-owned
     * event, not a future capability. Other legal Run events may advance the
     * Run before another task in this batch terminates. Task terminal merge
     * therefore commits against the current locked Run fence while the
     * pending Wait row remains the exactly-once aggregate owner.
     */
    const runFence = createProjectAgentRunFence({
      id: currentRun.id,
      runVersion: currentRun.runVersion,
      eventSeq: currentRun.eventSeq,
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

export async function listProjectAgentSessionWaits(
  input: ProjectAgentWaitScopeInput,
): Promise<ProjectAgentSessionWait[]> {
  const { assistantId, scopeRef } = buildWaitScope(input)
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
      AND status IN ('collecting', 'pending', 'resolved', 'claimed')
    ORDER BY createdAt DESC
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
  | { status: 'abandoned' }
  | { status: 'busy' }
  | { status: 'stale_or_not_claimable' }

export const PROJECT_AGENT_CONTINUATION_CLAIM_TTL_MS = 30_000

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
    Math.max(Math.floor(input.claimTtlMs ?? PROJECT_AGENT_CONTINUATION_CLAIM_TTL_MS), 30_000),
    30 * 60 * 1000,
  )
  const claimExpiresAt = new Date(Date.now() + claimTtlMs)
  return await prisma.$transaction(async (tx) => {
    const current = await tx.projectAgentWait.findUnique({ where: { id: input.waitId } })
    if (!current || current.runId !== input.runId) return { status: 'stale_or_not_claimable' }
    if (current.status === 'abandoned') return { status: 'abandoned' }
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
  if (
    !row
    || (
      row.terminalStatus !== 'completed'
      && row.terminalStatus !== 'failed'
      && row.terminalStatus !== 'canceled'
    )
    || !row.followUpKey
  ) {
    return null
  }
  if (!row.runId) throw new Error(`PROJECT_AGENT_WAIT_RUN_MISSING:${row.id}`)
  if (!row.activityId) throw new Error(`PROJECT_AGENT_WAIT_ACTIVITY_MISSING:${row.id}`)
  const executionSegment = createProjectAgentExecutionSegment({
    kind: 'task_follow_up',
    commandId: input.commandId,
  })
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

    const executionStarted = await tx.projectAgentEvent.findUnique({
      where: {
        idempotencyKey: projectAgentExecutionStartedIdempotencyKey(executionSegment.id),
      },
      select: { id: true },
    })
    if (executionStarted) return current as ProjectAgentWaitRow
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
        idempotencyKey: projectAgentExecutionStartedIdempotencyKey(executionSegment.id),
        event: {
          kind: 'run.execution_started',
          runId: input.runId,
          executionSegmentId: executionSegment.id,
          controlKind: executionSegment.controlKind,
        },
      }, {
        runFence: currentFence,
        idempotencyKey: `run-running:${input.runId}:continuation:${input.commandId}`,
        event: {
          kind: 'run.status_changed',
          runId: input.runId,
          status: 'running',
          expectedStatuses: ['awaiting_task'],
          stopReason: 'task_follow_up',
          errorCode: null,
          errorMessage: null,
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
  })
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
