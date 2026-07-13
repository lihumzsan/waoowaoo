import { createHash, randomUUID } from 'node:crypto'
import type { Locale } from '@/i18n/routing'
import { prisma } from '@/lib/prisma'
import { removeTaskJob } from '@/lib/task/queues'
import { cancelTask } from '@/lib/task/service'
import { submitTask } from '@/lib/task/submitter'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'

export type ImageBatchMeta = {
  id: string
  index: number
  total: number
}

function readBatchTotal(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const batch = (payload as Record<string, unknown>).batch
  if (!batch || typeof batch !== 'object' || Array.isArray(batch)) return null
  const total = (batch as Record<string, unknown>).total
  return typeof total === 'number' && Number.isInteger(total) && total > 0 ? total : null
}

type ImageBatchTaskType =
  | typeof TASK_TYPE.IMAGE_CHARACTER
  | typeof TASK_TYPE.IMAGE_LOCATION

function createBatchId(input: {
  userId: string
  projectId: string
  type: ImageBatchTaskType
  targetType: string
  targetId: string
  count: number
  regenerationToken?: string | null
}) {
  if (input.regenerationToken) return randomUUID()
  const digest = createHash('sha256')
    .update([
      input.userId,
      input.projectId,
      input.type,
      input.targetType,
      input.targetId,
      String(input.count),
    ].join(':'))
    .digest('hex')
    .slice(0, 32)
  return `batch-${digest}`
}

export async function submitImageBatchTasks(input: {
  userId: string
  locale: Locale
  requestId?: string | null
  projectId: string
  type: ImageBatchTaskType
  targetType: string
  targetId: string
  payload: Record<string, unknown>
  count: number
  regenerationToken?: string | null
}) {
  const count = Math.max(1, Math.floor(input.count))
  const batchId = createBatchId({ ...input, count })

  const activeTasks = await prisma.task.findMany({
    where: {
      userId: input.userId,
      projectId: input.projectId,
      type: input.type,
      targetType: input.targetType,
      targetId: input.targetId,
      status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
    },
    select: { id: true, payload: true },
  })
  const shouldSupersede = Boolean(input.regenerationToken)
    || activeTasks.some((task) => {
      const activeTotal = readBatchTotal(task.payload)
      return activeTotal === null || activeTotal !== count
    })

  if (shouldSupersede) {
    for (const task of activeTasks) {
      await cancelTask(task.id, 'Superseded by a newer image batch')
      await removeTaskJob(task.id).catch(() => false)
    }
  }

  const results = []
  try {
    for (let index = 0; index < count; index += 1) {
      const batch: ImageBatchMeta = { id: batchId, index, total: count }
      const regenerationSuffix = input.regenerationToken
        ? `:regen:${input.regenerationToken}`
        : ''
      results.push(await submitTask({
        userId: input.userId,
        locale: input.locale,
        requestId: input.requestId,
        projectId: input.projectId,
        type: input.type,
        targetType: input.targetType,
        targetId: input.targetId,
        payload: {
          ...input.payload,
          count: 1,
          imageIndex: index,
          batch,
        },
        dedupeKey: `${input.type}:${input.targetId}:batch:${batchId}:single:${index}${regenerationSuffix}`,
      }))
    }
  } catch (error) {
    await Promise.allSettled(
      results
        .filter((result) => !result.deduped)
        .map(async (result) => {
          await cancelTask(result.taskId, 'Image batch submission failed before every child was queued')
          await removeTaskJob(result.taskId).catch(() => false)
        }),
    )
    throw error
  }

  const first = results[0]
  return {
    success: true as const,
    async: true as const,
    taskId: first.taskId,
    taskIds: results.map((result) => result.taskId),
    batchId,
    status: first.status,
  }
}
