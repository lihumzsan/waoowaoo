import { randomUUID } from 'node:crypto'
import type { TaskBillingInfo, TaskType } from '@/lib/task/types'
import { TASK_STATUS } from '@/lib/task/types'
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { createTaskExecutionFingerprint } from '@/lib/task/execution-identity'

export async function createTestUser() {
  const suffix = randomUUID().slice(0, 8)
  return await prisma.user.create({
    data: {
      name: `billing_user_${suffix}`,
      email: `billing_${suffix}@example.com`,
    },
  })
}

export async function createTestProject(userId: string) {
  const suffix = randomUUID().slice(0, 8)
  return await prisma.project.create({
    data: {
      name: `Billing Project ${suffix}`,
      userId,
    },
  })
}

export async function seedBalance(userId: string, balance: number) {
  return await prisma.userBalance.upsert({
    where: { userId },
    create: {
      userId,
      balance,
      frozenAmount: 0,
      totalSpent: 0,
    },
    update: {
      balance,
      frozenAmount: 0,
      totalSpent: 0,
    },
  })
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
  billingInfo?: TaskBillingInfo | null
  payload?: Record<string, unknown> | null
}) {
  const executionInput = {
    userId: params.userId,
    projectId: params.projectId,
    type: params.type,
    targetType: params.targetType,
    targetId: params.targetId,
    payload: params.payload ?? null,
    operationId: params.operationId ?? null,
    operationSource: params.operationSource ?? null,
    operationRequestId: params.operationRequestId ?? null,
  }
  return await prisma.task.create({
    data: {
      id: params.id,
      userId: params.userId,
      projectId: params.projectId,
      type: params.type,
      targetType: params.targetType,
      targetId: params.targetId,
      operationId: params.operationId ?? null,
      operationRequestId: params.operationRequestId ?? null,
      operationSource: params.operationSource ?? null,
      status: TASK_STATUS.QUEUED,
      billingInfo: (params.billingInfo ?? Prisma.JsonNull) as unknown as Prisma.InputJsonValue,
      payload: (params.payload ?? Prisma.JsonNull) as unknown as Prisma.InputJsonValue,
      executionFingerprint: createTaskExecutionFingerprint(executionInput),
      queuedAt: new Date(),
    },
  })
}
