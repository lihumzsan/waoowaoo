import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import {
  TASK_EVENT_TYPE,
  TASK_SSE_EVENT_TYPE,
  type TaskEventType,
  type TaskLifecycleEventType,
  type TaskSSEEvent,
} from './types'
import { coerceTaskIntent, resolveTaskIntent } from './intent'
import { resolveProjectAgentWaitsForTaskEvent } from '@/lib/project-agent/waits'
import { runResolvedProjectAgentWaitFollowUpsForTaskEvent } from '@/lib/project-agent/server-follow-up'
import { withTaskCoveredTargetsPayload } from './covered-targets'
import { extractWorkspaceResourceRefsFromTaskLifecycleEvent } from '@/lib/workspace-resource/resource-impact'

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
  episodeId: string | null
  payload: unknown
}

type TaskEventModel = {
  create: (args: unknown) => Promise<TaskEventRow>
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
    value === TASK_EVENT_TYPE.COMPLETED ||
    value === TASK_EVENT_TYPE.FAILED
}

function normalizeLifecycleType(type: TaskEventType): TaskLifecycleEventType {
  if (isLifecycleEventType(type)) return type
  return TASK_EVENT_TYPE.PROCESSING
}

function isStreamEventType(type: string) {
  return type === TASK_SSE_EVENT_TYPE.STREAM
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
  episodeId?: string | null
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
    episodeId: params.episodeId || null,
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
      episodeId: true,
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
  episodeId?: string | null
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
    episodeId: params.episodeId || null,
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
          episodeId: true,
          payload: true,
        },
      })
    : []
  const taskMap = new Map<string, TaskMeta>(tasks.map((task) => [task.id, task]))

  return rows.map((row): TaskSSEEvent => {
    const task = taskMap.get(row.taskId)
    if (isStreamEventType(row.eventType)) {
      return buildStreamEvent({
        id: String(row.id),
        ts: row.createdAt.toISOString(),
        taskId: row.taskId,
        projectId: row.projectId,
        userId: row.userId,
        taskType: task?.type || null,
        targetType: task?.targetType || null,
        targetId: task?.targetId || null,
        episodeId: task?.episodeId || null,
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
      episodeId: task?.episodeId || null,
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
  episodeId?: string | null
  limit?: number
}) {
  const safeLimit = Number.isFinite(params.limit)
    ? Math.min(Math.max(Math.floor(params.limit ?? 200), 1), 1000)
    : 200
  const latestRows = await taskEventModel.findMany({
    where: {
      projectId: params.projectId,
      userId: params.userId,
      eventType: { in: [TASK_EVENT_TYPE.COMPLETED, TASK_EVENT_TYPE.FAILED] },
      ...(params.episodeId ? { task: { episodeId: params.episodeId } } : {}),
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

export async function publishTaskLifecycleEvent(params: {
  taskId: string
  projectId: string
  userId: string
  lifecycleType: TaskEventType
  taskType?: string | null
  targetType?: string | null
  targetId?: string | null
  episodeId?: string | null
  payload?: Record<string, unknown> | null
  persist?: boolean
}) {
  const persist = params.persist !== false
  const normalizedType = normalizeLifecycleType(params.lifecycleType)
  const taskMeta = await loadTaskMeta(params.taskId)
  const eventTaskType = params.taskType || taskMeta?.type || null
  const eventTargetType = params.targetType || taskMeta?.targetType || null
  const eventTargetId = params.targetId || taskMeta?.targetId || null
  const eventEpisodeId = params.episodeId || taskMeta?.episodeId || null
  const coveragePayload = taskMeta?.payload ?? params.payload ?? null
  const normalizedPayload = withTaskCoveredTargetsPayload({
    taskType: eventTaskType,
    targetType: eventTargetType,
    targetId: eventTargetId,
    payload: normalizeLifecyclePayload(
      params.lifecycleType,
      eventTaskType,
      params.payload || null,
    ),
    coveragePayload,
  })
  const affectedResources = extractWorkspaceResourceRefsFromTaskLifecycleEvent({
    taskType: eventTaskType,
    lifecycleType: normalizedType,
    projectId: params.projectId,
    targetType: eventTargetType,
    targetId: eventTargetId,
    episodeId: eventEpisodeId,
    payload: normalizedPayload,
  })
  const eventPayload = (
    normalizedType === TASK_EVENT_TYPE.COMPLETED ||
    normalizedType === TASK_EVENT_TYPE.FAILED
  )
    ? { ...normalizedPayload, affectedResources }
    : normalizedPayload
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
    episodeId: eventEpisodeId,
    payload: eventPayload,
    coveragePayload,
  })

  await resolveProjectAgentWaitsForTaskEvent({
    taskId: params.taskId,
    projectId: params.projectId,
    userId: params.userId,
    lifecycleType: normalizedType,
  })
  if (normalizedType === TASK_EVENT_TYPE.COMPLETED || normalizedType === TASK_EVENT_TYPE.FAILED) {
    await runResolvedProjectAgentWaitFollowUpsForTaskEvent({
      projectId: params.projectId,
      userId: params.userId,
      episodeId: eventEpisodeId,
    })
  }
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
  episodeId?: string | null
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
    episodeId: params.episodeId,
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
  episodeId?: string | null
  payload?: Record<string, unknown> | null
  persist?: boolean
}) {
  if (!STREAM_EPHEMERAL_ENABLED) return null

  const persist = params.persist === true
  const normalizedPayload = normalizeStreamPayload(params.taskType, params.payload || null)
  const event = persist
    ? await taskEventModel.create({
        data: {
          taskId: params.taskId,
          projectId: params.projectId,
          userId: params.userId,
          eventType: TASK_SSE_EVENT_TYPE.STREAM,
          payload: normalizedPayload,
        },
      })
    : null
  const ts = (event?.createdAt || new Date()).toISOString()
  const id = event?.id ? String(event.id) : createEphemeralId()

  const message = buildStreamEvent({
    id,
    ts,
    taskId: params.taskId,
    projectId: params.projectId,
    userId: params.userId,
    taskType: params.taskType || null,
    targetType: params.targetType || null,
    targetId: params.targetId || null,
    episodeId: params.episodeId || null,
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
