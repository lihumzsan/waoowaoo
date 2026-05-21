import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

const ACTIVE_VIDEO_GROUP_STATUSES = ['queued', 'processing'] as const
const ACTIVE_TASK_STATUSES = new Set(['queued', 'processing'])
const VIDEO_GROUP_ACTIVE_GRACE_MS = 120_000

type ActiveVideoGroup = {
  readonly id: string
  readonly status: string
  readonly taskId: string | null
  readonly shotNumbers: unknown
  readonly videoUrl: string | null
  readonly videoMediaId: string | null
  readonly errorCode: string | null
  readonly errorMessage: string | null
  readonly updatedAt: Date
}

type TaskSnapshot = {
  readonly id: string
  readonly status: string
  readonly errorCode: string | null
  readonly errorMessage: string | null
}

function readShotNumbers(value: unknown): readonly number[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0)
}

function hasShotOverlap(left: readonly number[], right: ReadonlySet<number>): boolean {
  return left.some((shotNumber) => right.has(shotNumber))
}

function terminalErrorCode(task: TaskSnapshot): string {
  if (task.status === 'failed') return task.errorCode?.trim() || 'VIDEO_GROUP_TASK_FAILED'
  if (task.status === 'canceled') return task.errorCode?.trim() || 'VIDEO_GROUP_TASK_CANCELED'
  return task.errorCode?.trim() || `VIDEO_GROUP_TASK_${task.status.toUpperCase()}`
}

function terminalErrorMessage(task: TaskSnapshot): string {
  if (task.errorMessage?.trim()) return task.errorMessage.trim()
  if (task.status === 'failed') return 'Video group task failed'
  if (task.status === 'canceled') return 'Video group task canceled'
  return `Video group task ended with status ${task.status}`
}

async function markGroupCompleted(group: ActiveVideoGroup): Promise<void> {
  await prisma.projectVideoGroup.updateMany({
    where: {
      id: group.id,
      status: { in: [...ACTIVE_VIDEO_GROUP_STATUSES] },
    },
    data: {
      status: 'completed',
      taskId: null,
      errorCode: null,
      errorMessage: null,
    },
  })
}

async function markGroupFailed(input: {
  readonly group: ActiveVideoGroup
  readonly errorCode: string
  readonly errorMessage: string
}): Promise<void> {
  await prisma.projectVideoGroup.updateMany({
    where: {
      id: input.group.id,
      status: { in: [...ACTIVE_VIDEO_GROUP_STATUSES] },
    },
    data: {
      status: 'failed',
      taskId: null,
      errorCode: input.errorCode.slice(0, 80),
      errorMessage: input.errorMessage.slice(0, 2000),
    },
  })
}

async function reconcileStaleGroup(input: {
  readonly group: ActiveVideoGroup
  readonly task: TaskSnapshot | null
  readonly now: Date
}): Promise<boolean> {
  const { group, task, now } = input
  if (task && ACTIVE_TASK_STATUSES.has(task.status)) return true

  if (task?.status === 'completed') {
    if (group.videoUrl || group.videoMediaId) {
      await markGroupCompleted(group)
      return false
    }
    await markGroupFailed({
      group,
      errorCode: 'VIDEO_GROUP_OUTPUT_MISSING',
      errorMessage: 'Video group task completed without persisted output',
    })
    return false
  }

  if (task) {
    await markGroupFailed({
      group,
      errorCode: terminalErrorCode(task),
      errorMessage: terminalErrorMessage(task),
    })
    return false
  }

  const activeAgeMs = now.getTime() - group.updatedAt.getTime()
  if (activeAgeMs < VIDEO_GROUP_ACTIVE_GRACE_MS) return true

  if (group.videoUrl || group.videoMediaId) {
    await markGroupCompleted(group)
    return false
  }

  if (group.errorCode || group.errorMessage) {
    await markGroupFailed({
      group,
      errorCode: group.errorCode?.trim() || 'VIDEO_GROUP_TASK_FAILED',
      errorMessage: group.errorMessage?.trim() || 'Video group task failed',
    })
    return false
  }

  await markGroupFailed({
    group,
    errorCode: 'VIDEO_GROUP_TASK_MISSING',
    errorMessage: 'Video group is active but has no linked task',
  })
  return false
}

export async function assertNoRunningVideoGroupOverlap(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly shotNumbers: readonly number[]
  readonly errorCode: string
}): Promise<void> {
  const runningGroups = await prisma.projectVideoGroup.findMany({
    where: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      status: { in: [...ACTIVE_VIDEO_GROUP_STATUSES] },
    },
    select: {
      id: true,
      status: true,
      taskId: true,
      shotNumbers: true,
      videoUrl: true,
      videoMediaId: true,
      errorCode: true,
      errorMessage: true,
      updatedAt: true,
    },
  })
  const inputSet = new Set(input.shotNumbers)
  const overlappingGroups = runningGroups.filter((group) => hasShotOverlap(readShotNumbers(group.shotNumbers), inputSet))
  if (overlappingGroups.length === 0) return

  const taskIds = overlappingGroups
    .map((group) => group.taskId)
    .filter((taskId): taskId is string => typeof taskId === 'string' && taskId.trim().length > 0)
  const tasks = taskIds.length > 0
    ? await prisma.task.findMany({
        where: { id: { in: taskIds } },
        select: {
          id: true,
          status: true,
          errorCode: true,
          errorMessage: true,
        },
      })
    : []
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const now = new Date()
  const activeGroups: ActiveVideoGroup[] = []

  for (const group of overlappingGroups) {
    const task = group.taskId ? taskById.get(group.taskId) ?? null : null
    const stillRunning = await reconcileStaleGroup({ group, task, now })
    if (stillRunning) activeGroups.push(group)
  }

  if (activeGroups.length > 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: input.errorCode,
      groupIds: activeGroups.map((group) => group.id),
      shotNumbers: [...new Set(activeGroups.flatMap((group) => readShotNumbers(group.shotNumbers)))],
    })
  }
}
