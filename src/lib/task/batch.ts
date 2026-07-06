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

export async function readTaskBatchStatus(batchKey: string): Promise<{
  readonly batchKey: string
  readonly total: number
  readonly terminal: number
  readonly failed: number
  readonly settled: boolean
}> {
  const normalizedBatchKey = batchKey.trim()
  if (!normalizedBatchKey) throw new Error('TASK_BATCH_KEY_REQUIRED')
  const [total, terminal, failed] = await Promise.all([
    prisma.task.count({ where: { batchKey: normalizedBatchKey } }),
    prisma.task.count({
      where: {
        batchKey: normalizedBatchKey,
        status: { in: Array.from(TASK_TERMINAL_STATUSES) },
      },
    }),
    prisma.task.count({
      where: {
        batchKey: normalizedBatchKey,
        status: TASK_STATUS.FAILED,
      },
    }),
  ])
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
  return await prisma.task.findMany({
    where: {
      batchKey: normalizedBatchKey,
      status: TASK_STATUS.FAILED,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      type: true,
      targetType: true,
      targetId: true,
      errorCode: true,
      errorMessage: true,
    },
  })
}
