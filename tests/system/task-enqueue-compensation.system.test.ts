import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiError } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { TASK_EVENT_TYPE, TASK_TYPE } from '@/lib/task/types'
import { createTestProject, createTestUser, seedBalance } from '../helpers/billing-fixtures'
import { resetBillingState } from '../helpers/db-reset'
import { prisma } from '../helpers/prisma'

const queueFailure = vi.hoisted(() => ({
  message: 'Redis queue unavailable during enqueue',
}))

vi.mock('@/lib/task/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/task/queues')>()),
  addTaskJob: vi.fn(async () => {
    throw new Error(queueFailure.message)
  }),
}))

describe('system - task enqueue compensation', () => {
  const originalBillingMode = process.env.BILLING_MODE

  beforeEach(async () => {
    await resetBillingState()
    process.env.BILLING_MODE = 'ENFORCE'
    queueFailure.message = 'Redis queue unavailable during enqueue'
  })

  afterEach(() => {
    if (originalBillingMode === undefined) delete process.env.BILLING_MODE
    else process.env.BILLING_MODE = originalBillingMode
  })

  it('[P0:SYS-QUEUE-ENQUEUE-COMPENSATION] fails the task and rolls back its exact billing freeze as one failure boundary', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 10)

    await expect(submitTask({
      userId: user.id,
      locale: 'zh',
      projectId: project.id,
      type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
      targetType: 'ProjectEditChapter',
      targetId: project.id,
      payload: {
        analysisModel: 'openrouter::openai/gpt-5.5',
        episodeId: 'system-enqueue-episode',
      },
      dedupeKey: `system-enqueue-compensation:${project.id}`,
      operationId: 'generate_edit_script',
      operationSource: 'assistant',
      operationRequestId: `system-enqueue-request:${project.id}`,
    })).rejects.toMatchObject({
      code: 'EXTERNAL_ERROR',
    } satisfies Pick<ApiError, 'code'>)

    const [tasks, balance, freezes] = await Promise.all([
      prisma.task.findMany({
        where: { userId: user.id, projectId: project.id },
        include: { events: { orderBy: { createdAt: 'asc' } } },
      }),
      prisma.userBalance.findUnique({ where: { userId: user.id } }),
      prisma.balanceFreeze.findMany({ where: { userId: user.id } }),
    ])

    expect(tasks).toHaveLength(1)
    const task = tasks[0]
    expect(task).toMatchObject({
      status: 'failed',
      errorCode: 'ENQUEUE_FAILED',
      enqueueAttempts: 1,
      lastEnqueueError: queueFailure.message,
      operationId: 'generate_edit_script',
      operationSource: 'assistant',
    })
    expect(task?.errorMessage).toContain(queueFailure.message)
    expect(task?.billingInfo).toMatchObject({
      billable: true,
      modeSnapshot: 'ENFORCE',
      status: 'rolled_back',
      freezeId: freezes[0]?.id,
    })
    expect(task?.events.map((event) => event.eventType)).toEqual([
      TASK_EVENT_TYPE.CREATED,
      TASK_EVENT_TYPE.FAILED,
    ])

    expect(freezes).toHaveLength(1)
    expect(freezes[0]).toMatchObject({
      taskId: task?.id,
      status: 'rolled_back',
    })
    expect(balance?.balance.toNumber()).toBeCloseTo(10, 8)
    expect(balance?.frozenAmount.toNumber()).toBeCloseTo(0, 8)
    expect(balance?.totalSpent.toNumber()).toBeCloseTo(0, 8)
    expect(await prisma.balanceTransaction.count({ where: { userId: user.id } })).toBe(0)
  })
})
