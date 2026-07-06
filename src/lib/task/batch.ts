import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { TASK_STATUS, type TaskStatus } from './types'

export const TASK_TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  TASK_STATUS.COMPLETED,
  TASK_STATUS.FAILED,
  TASK_STATUS.CANCELED,
  TASK_STATUS.DISMISSED,
])

export function createTaskBatchKey(prefix: string): string {
  const normalizedPrefix = prefix.trim()
  if (!normalizedPrefix) throw new Error('TASK_BATCH_PREFIX_REQUIRED')
  return `${normalizedPrefix}:${randomUUID()}`
}

type TaskBatchRow = {
  readonly id: string
  readonly type: string
  readonly status: string
  readonly targetType: string | null
  readonly targetId: string | null
  readonly errorCode: string | null
  readonly errorMessage: string | null
}

function taskBatchTargetKey(task: TaskBatchRow): string {
  const targetType = task.targetType?.trim() || 'unknown'
  const targetId = task.targetId?.trim() || task.id
  return `${task.type}:${targetType}:${targetId}`
}

function latestTaskPerBatchTarget(tasks: readonly TaskBatchRow[]): TaskBatchRow[] {
  const latestByTargetKey = new Map<string, TaskBatchRow>()
  for (const task of tasks) {
    latestByTargetKey.set(taskBatchTargetKey(task), task)
  }
  return Array.from(latestByTargetKey.values())
}

export async function readTaskBatchStatus(batchKey: string): Promise<{
  readonly batchKey: string
  readonly total: number
  readonly terminal: number
  readonly failed: number
  readonly settled: boolean
}> {
  const normalizedBatchKey = batchKey.trim()
  if (!normalizedBatchKey) throw new Error('TASK_BATCH_KEY_REQUIRED')
  const tasks = await prisma.task.findMany({
    where: { batchKey: normalizedBatchKey },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      type: true,
      status: true,
      targetType: true,
      targetId: true,
      errorCode: true,
      errorMessage: true,
    },
  })
  const latestTasks = latestTaskPerBatchTarget(tasks)
  const total = latestTasks.length
  const terminal = latestTasks.filter((task) => TASK_TERMINAL_STATUSES.has(task.status as TaskStatus)).length
  const failed = latestTasks.filter((task) => task.status === TASK_STATUS.FAILED).length
  return {
    batchKey: normalizedBatchKey,
    total,
    terminal,
    failed,
    settled: total > 0 && total === terminal,
  }
}

export async function listTaskBatchFailures(batchKey: string): Promise<readonly {
  readonly id: string
  readonly type: string
  readonly targetType: string
  readonly targetId: string
  readonly errorCode: string | null
  readonly errorMessage: string | null
}[]> {
  const normalizedBatchKey = batchKey.trim()
  if (!normalizedBatchKey) throw new Error('TASK_BATCH_KEY_REQUIRED')
  const tasks = await prisma.task.findMany({
    where: {
      batchKey: normalizedBatchKey,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      type: true,
      status: true,
      targetType: true,
      targetId: true,
      errorCode: true,
      errorMessage: true,
    },
  })
  return latestTaskPerBatchTarget(tasks)
    .filter((task) => task.status === TASK_STATUS.FAILED)
    .map((task) => ({
      id: task.id,
      type: task.type,
      targetType: task.targetType ?? '',
      targetId: task.targetId ?? '',
      errorCode: task.errorCode,
      errorMessage: task.errorMessage,
    }))
}

export async function readLatestFailedTaskBatchKeyForTarget(input: {
  readonly projectId: string
  readonly episodeId?: string | null
  readonly type: string
  readonly targetType: string
  readonly targetId: string
}): Promise<string | null> {
  const task = await prisma.task.findFirst({
    where: {
      projectId: input.projectId,
      ...(input.episodeId ? { episodeId: input.episodeId } : {}),
      type: input.type,
      targetType: input.targetType,
      targetId: input.targetId,
      batchKey: { not: null },
      status: { in: [TASK_STATUS.FAILED, TASK_STATUS.CANCELED, TASK_STATUS.DISMISSED] },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { batchKey: true },
  })
  const batchKey = task?.batchKey?.trim() ?? ''
  return batchKey || null
}
