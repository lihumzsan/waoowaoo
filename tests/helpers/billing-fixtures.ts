import { randomUUID } from 'node:crypto'
import type { TaskType } from '@/lib/task/types'
import { TASK_STATUS } from '@/lib/task/types'
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { createTaskExecutionFingerprint } from '@/lib/task/execution-identity'

export async function createTestUser() {
  const suffix = randomUUID().slice(0, 8)
  return await prisma.user.create({ data: { name: `test_user_${suffix}`, email: `test_${suffix}@example.com` } })
}

export async function createTestProject(userId: string) {
  const suffix = randomUUID().slice(0, 8)
  return await prisma.project.create({ data: { name: `Test Project ${suffix}`, userId } })
}

export async function createQueuedTask(params: {
  id: string
  userId: string
  projectId: string
  type: TaskType
  targetType: string
  targetId: string
  operationId?: string | null
  operationRequestId?: string | null
  operationSource?: string | null
  payload?: Record<string, unknown> | null
}) {
  const executionInput = {
    userId: params.userId, projectId: params.projectId, type: params.type,
    targetType: params.targetType, targetId: params.targetId, payload: params.payload ?? null,
    operationId: params.operationId ?? null, operationSource: params.operationSource ?? null,
    operationRequestId: params.operationRequestId ?? null,
  }
  return await prisma.task.create({
    data: {
      id: params.id, userId: params.userId, projectId: params.projectId, type: params.type,
      targetType: params.targetType, targetId: params.targetId,
      operationId: params.operationId ?? null, operationRequestId: params.operationRequestId ?? null,
      operationSource: params.operationSource ?? null, status: TASK_STATUS.QUEUED,
      payload: params.payload === null || params.payload === undefined
        ? Prisma.JsonNull
        : params.payload as Prisma.InputJsonValue,
      executionFingerprint: createTaskExecutionFingerprint(executionInput), queuedAt: new Date(),
    },
  })
}
