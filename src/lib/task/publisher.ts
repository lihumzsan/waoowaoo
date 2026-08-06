import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import {
  TASK_EVENT_TYPE,
  TASK_TERMINAL_EVENT_TYPES,
  isTaskTerminalEventType,
  type TaskEventType,
  type TaskLifecycleEventType,
  type WorkspaceResourceRef,
} from './types'
import {
  TASK_SSE_EVENT_TYPE,
  type TaskSSEEvent,
} from '@/lib/sse/events'
import { coerceTaskIntent, resolveTaskIntent } from './intent'
import { withTaskCoveredTargetsPayload } from './covered-targets'
import { resolveUnifiedErrorCode } from '@/lib/errors/codes'

// No writer since the structured canvas stream removal; the type only keeps
// historical TaskEvent rows replayable as plain stream events.
const LEGACY_STRUCTURED_STREAM_CHECKPOINT_EVENT_TYPE = 'task.stream_checkpoint'

const CHANNEL_PREFIX = 'task-events:project:'
const STREAM_EPHEMERAL_ENABLED = process.env.LLM_STREAM_EPHEMERAL_ENABLED !== 'false'

type TaskEventRow = {
  id: number
  taskId: string
  projectId: string
  userId: string
  eventType: string
  payload: Record<string, unknown> | null
  createdAt: Date
}

type TaskMeta = {
  id: string
  type: string
  targetType: string
  targetId: string
  payload: unknown
}

type TaskEventModel = {
  create: (args: unknown) => Promise<TaskEventRow>
  upsert: (args: unknown) => Promise<TaskEventRow>
  findUnique: (args: unknown) => Promise<TaskEventRow | null>
  findMany: (args: unknown) => Promise<TaskEventRow[]>
}

type TaskModel = {
  findMany: (args: unknown) => Promise<TaskMeta[]>
}

const taskEventModel = (prisma as unknown as { taskEvent: TaskEventModel }).taskEvent
const taskModel = (prisma as unknown as { task: TaskModel }).task

function createEphemeralId() {
  return `ephemeral:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
}

function isLifecycleEventType(value: string): value is TaskLifecycleEventType {
  return value === TASK_EVENT_TYPE.CREATED ||
    value === TASK_EVENT_TYPE.PROCESSING ||
    value === TASK_EVENT_TYPE.PROGRESS ||
    value === TASK_EVENT_TYPE.COMPLETED ||
    value === TASK_EVENT_TYPE.FAILED ||
    value === TASK_EVENT_TYPE.CANCELED
}

function normalizeLifecycleType(type: TaskEventType): TaskLifecycleEventType {
  if (isLifecycleEventType(type)) return type
  throw new Error(`TASK_LIFECYCLE_TYPE_UNSUPPORTED:${type}`)
}

function isStreamEventType(type: string) {
  return type === TASK_SSE_EVENT_TYPE.STREAM
}

function isStreamCheckpointEventType(type: string) {
  return type === LEGACY_STRUCTURED_STREAM_CHECKPOINT_EVENT_TYPE
}

function shouldReplayLifecycleRow(type: string) {
  return isLifecycleEventType(type)
}

function shouldReplayTaskRow(type: string) {
  return shouldReplayLifecycleRow(type) || isStreamEventType(type)
}

function normalizeLifecyclePayload(
  type: TaskEventType,
  taskType: string | null | undefined,
  payload?: Record<string, unknown> | null,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(payload || {}) }
  const lifecycleType = normalizeLifecycleType(type)
  const payloadUi = next.ui && typeof next.ui === 'object' && !Array.isArray(next.ui)
    ? (next.ui as Record<string, unknown>)
    : null
  next.lifecycleType = lifecycleType
  next.intent = coerceTaskIntent(next.intent ?? payloadUi?.intent, taskType)
  if (lifecycleType === TASK_EVENT_TYPE.FAILED || lifecycleType === TASK_EVENT_TYPE.CANCELED) {
    // Task.failure remains the diagnostic fact. Lifecycle events are replayed
    // to browsers and tools, so terminal projections expose codes only.
    delete next.message
    delete next.errorMessage
    if (lifecycleType === TASK_EVENT_TYPE.FAILED) {
      next.errorCode = resolveUnifiedErrorCode(next.errorCode) ?? 'INTERNAL_ERROR'
    } else {
      delete next.errorCode
    }
  }

  return next
}

function buildLifecycleEvent(params: {
  id: string
  ts: string
  lifecycleType: TaskEventType
  taskId: string
  projectId: string
  userId: string
  taskType?: string | null
  targetType?: string | null
  targetId?: string | null
  payload?: Record<string, unknown> | null
  coveragePayload?: unknown
}): TaskSSEEvent {
  return {
    id: params.id,
    type: TASK_SSE_EVENT_TYPE.LIFECYCLE,
    taskId: params.taskId,
    projectId: params.projectId,
    userId: params.userId,
    ts: params.ts,
    taskType: params.taskType || null,
    targetType: params.targetType || null,
    targetId: params.targetId || null,
    payload: withTaskCoveredTargetsPayload({
      taskType: params.taskType,
      targetType: params.targetType,
      targetId: params.targetId,
      payload: normalizeLifecyclePayload(
        params.lifecycleType,
        params.taskType,
        params.payload || null,
      ),
      coveragePayload: params.coveragePayload ?? params.payload ?? null,
    }),
  }
}

async function loadTaskMeta(taskId: string): Promise<TaskMeta | null> {
  const rows = await taskModel.findMany({
    where: { id: { in: [taskId] } },
    select: {
      id: true,
      type: true,
      targetType: true,
      targetId: true,
      payload: true,
    },
  })
  return rows[0] ?? null
}

function normalizeStreamPayload(
  taskType: string | null | undefined,
  payload?: Record<string, unknown> | null,
): Record<string, unknown> {
  return {
    ...(payload || {}),
    intent: resolveTaskIntent(taskType),
  }
}

function buildStreamEvent(params: {
  id: string
  ts: string
  taskId: string
  projectId: string
  userId: string
  taskType?: string | null
  targetType?: string | null
  targetId?: string | null
  payload?: Record<string, unknown> | null
}): TaskSSEEvent {
  return {
    id: params.id,
    type: TASK_SSE_EVENT_TYPE.STREAM,
    taskId: params.taskId,
    projectId: params.projectId,
    userId: params.userId,
    ts: params.ts,
    taskType: params.taskType || null,
    targetType: params.targetType || null,
    targetId: params.targetId || null,
    payload: normalizeStreamPayload(params.taskType, params.payload || null),
  }
}

async function mapRowsToReplayEvents(rows: TaskEventRow[]): Promise<TaskSSEEvent[]> {
  if (rows.length === 0) return []

  const taskIds = Array.from(new Set(rows.map((row) => row.taskId)))
  const tasks: TaskMeta[] = taskIds.length
    ? await taskModel.findMany({
        where: { id: { in: taskIds } },
        select: {
          id: true,
          type: true,
          targetType: true,
          targetId: true,
          payload: true,
        },
      })
    : []
  const taskMap = new Map<string, TaskMeta>(tasks.map((task) => [task.id, task]))

  return rows.map((row): TaskSSEEvent => {
    const task = taskMap.get(row.taskId)
    if (isStreamEventType(row.eventType) || isStreamCheckpointEventType(row.eventType)) {
      return buildStreamEvent({
        id: String(row.id),
        ts: row.createdAt.toISOString(),
        taskId: row.taskId,
        projectId: row.projectId,
        userId: row.userId,
        taskType: task?.type || null,
        targetType: task?.targetType || null,
        targetId: task?.targetId || null,
        payload: row.payload || null,
      })
    }
    const lifecycleType = row.eventType as TaskEventType
    return buildLifecycleEvent({
      id: String(row.id),
      ts: row.createdAt.toISOString(),
      lifecycleType,
      taskId: row.taskId,
      projectId: row.projectId,
      userId: row.userId,
      taskType: task?.type || null,
      targetType: task?.targetType || null,
      targetId: task?.targetId || null,
      payload: row.payload || null,
      coveragePayload: task?.payload ?? row.payload ?? null,
    })
  })
}

export async function listTaskLifecycleEvents(taskId: string, limit = 500) {
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 5000) : 500
  const latestRows = await taskEventModel.findMany({
    where: { taskId },
    orderBy: { id: 'desc' },
    take: safeLimit,
  })
  const rows = [...latestRows].reverse()
  const replayRows = rows.filter((row) => shouldReplayTaskRow(row.eventType))
  return await mapRowsToReplayEvents(replayRows)
}

export async function listRecentTerminalLifecycleEvents(params: {
  projectId: string
  userId: string
  limit?: number
}) {
  const safeLimit = Number.isFinite(params.limit)
    ? Math.min(Math.max(Math.floor(params.limit ?? 200), 1), 1000)
    : 200
  const latestRows = await taskEventModel.findMany({
    where: {
      projectId: params.projectId,
      userId: params.userId,
      eventType: { in: TASK_TERMINAL_EVENT_TYPES },
    },
    orderBy: { id: 'desc' },
    take: safeLimit,
  })
  const events = await mapRowsToReplayEvents([...latestRows].reverse())
  return events
}

export function getProjectChannel(projectId: string) {
  return `${CHANNEL_PREFIX}${projectId}`
}

export function buildTaskLifecycleEventPayload(params: {
  taskId: string
  projectId: string
  lifecycleType: TaskEventType
  taskType: string
  targetType: string
  targetId: string
  payload?: Record<string, unknown> | null
  coveragePayload?: unknown
  affectedResources?: readonly WorkspaceResourceRef[]
}): Record<string, unknown> {
  const normalizedType = normalizeLifecycleType(params.lifecycleType)
  const normalizedPayload = withTaskCoveredTargetsPayload({
    taskType: params.taskType,
    targetType: params.targetType,
    targetId: params.targetId,
    payload: normalizeLifecyclePayload(
      params.lifecycleType,
      params.taskType,
      params.payload || null,
    ),
    coveragePayload: params.coveragePayload ?? params.payload ?? null,
  })
  if (normalizedType === TASK_EVENT_TYPE.CREATED) {
    if (!params.affectedResources) {
      throw new Error(`TASK_CREATED_AFFECTED_RESOURCES_REQUIRED:${params.taskId}`)
    }
    return { ...normalizedPayload, affectedResources: [...params.affectedResources] }
  }
  if (!isTaskTerminalEventType(normalizedType)) {
    if (params.affectedResources !== undefined) {
      throw new Error(`TASK_NON_TERMINAL_AFFECTED_RESOURCES_FORBIDDEN:${params.taskId}`)
    }
    return normalizedPayload
  }
  if (!params.affectedResources) {
    throw new Error(`TASK_TERMINAL_AFFECTED_RESOURCES_REQUIRED:${params.taskId}`)
  }
  return { ...normalizedPayload, affectedResources: [...params.affectedResources] }
}

export async function publishPersistedTaskEventById(eventId: number, expectedTaskId?: string): Promise<TaskSSEEvent> {
  const row = await taskEventModel.findUnique({ where: { id: eventId } })
  if (!row) throw new Error(`TASK_EVENT_NOT_FOUND:${String(eventId)}`)
  if (expectedTaskId && row.taskId !== expectedTaskId) {
    throw new Error(`TASK_EVENT_TASK_MISMATCH:${String(eventId)}:${expectedTaskId}:${row.taskId}`)
  }
  const [message] = await mapRowsToReplayEvents([row])
  if (!message) throw new Error(`TASK_EVENT_MESSAGE_NOT_BUILT:${String(eventId)}`)
  await redis.publish(getProjectChannel(row.projectId), JSON.stringify(message))
  return message
}

async function publishTaskLifecycleEvent(params: {
  taskId: string
  projectId: string
  userId: string
  lifecycleType: TaskEventType
  taskType?: string | null
  targetType?: string | null
  targetId?: string | null
  payload?: Record<string, unknown> | null
  persist?: boolean
}) {
  if (isTaskTerminalEventType(params.lifecycleType)) {
    throw new Error(`TASK_TERMINAL_EVENT_REQUIRES_TERMINAL_SERVICE:${params.taskId}`)
  }
  const persist = params.persist !== false
  const normalizedType = normalizeLifecycleType(params.lifecycleType)
  const taskMeta = await loadTaskMeta(params.taskId)
  const eventTaskType = params.taskType || taskMeta?.type || null
  const eventTargetType = params.targetType || taskMeta?.targetType || null
  const eventTargetId = params.targetId || taskMeta?.targetId || null
  const coveragePayload = taskMeta?.payload ?? params.payload ?? null
  const eventPayload = eventTaskType && eventTargetType && eventTargetId
    ? buildTaskLifecycleEventPayload({
        taskId: params.taskId,
        projectId: params.projectId,
        lifecycleType: params.lifecycleType,
        taskType: eventTaskType,
        targetType: eventTargetType,
        targetId: eventTargetId,
        payload: params.payload,
        coveragePayload,
      })
    : normalizeLifecyclePayload(params.lifecycleType, eventTaskType, params.payload || null)
  const event = persist
    ? await taskEventModel.create({
        data: {
          taskId: params.taskId,
          projectId: params.projectId,
          userId: params.userId,
          eventType: normalizedType,
          payload: eventPayload,
        },
      })
    : null
  const ts = (event?.createdAt || new Date()).toISOString()
  const id = event?.id ? String(event.id) : createEphemeralId()

  const message = buildLifecycleEvent({
    id,
    ts,
    lifecycleType: params.lifecycleType,
    taskId: params.taskId,
    projectId: params.projectId,
    userId: params.userId,
    taskType: eventTaskType,
    targetType: eventTargetType,
    targetId: eventTargetId,
    payload: eventPayload,
    coveragePayload,
  })

  await redis.publish(getProjectChannel(params.projectId), JSON.stringify(message))
  return message
}

export async function publishTaskEvent(params: {
  taskId: string
  projectId: string
  userId: string
  type: TaskEventType
  taskType?: string | null
  targetType?: string | null
  targetId?: string | null
  payload?: Record<string, unknown> | null
  persist?: boolean
}) {
  return await publishTaskLifecycleEvent({
    taskId: params.taskId,
    projectId: params.projectId,
    userId: params.userId,
    lifecycleType: params.type,
    taskType: params.taskType,
    targetType: params.targetType,
    targetId: params.targetId,
    payload: params.payload,
    persist: params.persist,
  })
}

export async function publishTaskStreamEvent(params: {
  taskId: string
  projectId: string
  userId: string
  taskType?: string | null
  targetType?: string | null
  targetId?: string | null
  payload?: Record<string, unknown> | null
}) {
  if (!STREAM_EPHEMERAL_ENABLED) return null

  const normalizedPayload = normalizeStreamPayload(params.taskType, params.payload || null)
  const message = buildStreamEvent({
    id: createEphemeralId(),
    ts: new Date().toISOString(),
    taskId: params.taskId,
    projectId: params.projectId,
    userId: params.userId,
    taskType: params.taskType || null,
    targetType: params.targetType || null,
    targetId: params.targetId || null,
    payload: normalizedPayload,
  })

  await redis.publish(getProjectChannel(params.projectId), JSON.stringify(message))
  return message
}

export async function listEventsAfter(projectId: string, afterId: number, limit = 200) {
  const pageSize = Math.max(limit * 2, 400)
  const maxScanRows = Math.max(limit * 50, 20_000)
  let cursor = afterId
  let scannedRows = 0
  const collected: TaskEventRow[] = []

  while (collected.length < limit && scannedRows < maxScanRows) {
    const rows = await taskEventModel.findMany({
      where: {
        projectId,
        id: { gt: cursor },
      },
      orderBy: { id: 'asc' },
      take: pageSize,
    })

    if (rows.length === 0) break
    scannedRows += rows.length

    for (const row of rows) {
      if (!shouldReplayTaskRow(row.eventType)) continue
      collected.push(row)
      if (collected.length >= limit) break
    }

    cursor = rows[rows.length - 1]?.id || cursor
    if (rows.length < pageSize) break
  }

  return await mapRowsToReplayEvents(collected.slice(0, limit))
}
