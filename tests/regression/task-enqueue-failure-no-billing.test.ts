import { beforeEach, describe, expect, it, vi } from 'vitest'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { prisma } from '../helpers/prisma'
import { resetBillingState } from '../helpers/db-reset'
import { createTestUser } from '../helpers/task-fixtures'

const queueState = vi.hoisted(() => ({
  message: 'queue add failed',
}))

vi.mock('@/lib/task/queues', () => ({
  addTaskJob: vi.fn(async () => {
    throw new Error(queueState.message)
  }),
}))

vi.mock('@/lib/task/publisher', () => ({
  publishTaskEvent: vi.fn(async () => ({})),
}))

describe('regression - enqueue failure without billing', () => {
  beforeEach(async () => {
    await resetBillingState()
    vi.clearAllMocks()
    process.env.BILLING_MODE = 'ENFORCE'
    queueState.message = 'queue unavailable'
  })

  it('marks queue failure without creating balance freeze records', async () => {
    const user = await createTestUser()

    await expect(
      submitTask({
        userId: user.id,
        locale: 'en',
        projectId: 'project-regression-enqueue',
        type: TASK_TYPE.VOICE_LINE,
        targetType: 'VoiceLine',
        targetId: 'line-regression-enqueue',
        payload: { maxSeconds: 6 },
      }),
    ).rejects.toMatchObject({ code: 'EXTERNAL_ERROR' })

    const task = await prisma.task.findFirst({
      where: {
        userId: user.id,
        type: TASK_TYPE.VOICE_LINE,
      },
      orderBy: { createdAt: 'desc' },
    })

    expect(task).toMatchObject({
      status: 'failed',
      errorCode: 'ENQUEUE_FAILED',
      billingInfo: null,
    })
    expect(await prisma.balanceFreeze.count()).toBe(0)
    expect(await prisma.balanceTransaction.count()).toBe(0)
    expect(await prisma.usageCost.count()).toBe(0)
  })
})
