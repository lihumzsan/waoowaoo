import { beforeEach, describe, expect, it, vi } from 'vitest'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { prisma } from '../helpers/prisma'
import { resetBillingState } from '../helpers/db-reset'
import { createTestUser, seedBalance } from '../helpers/billing-fixtures'

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
  listRecentTerminalLifecycleEvents: vi.fn(async () => []),
}))

describe('regression - enqueue compensation', () => {
  beforeEach(async () => {
    await resetBillingState()
    vi.clearAllMocks()
    process.env.BILLING_MODE = 'ENFORCE'
    queueState.message = 'queue unavailable'
  })

  it('rolls back frozen balance when queue submission fails', async () => {
    const user = await createTestUser()
    await seedBalance(user.id, 10)

    await expect(
      submitTask({
        userId: user.id,
        locale: 'en',
        projectId: 'project-regression-enqueue',
        type: TASK_TYPE.MUSIC_GENERATE,
        targetType: 'Project',
        targetId: 'project-regression-enqueue',
        payload: { musicModel: 'google::lyria-3-pro-preview', durationSeconds: 6 },
        operationConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'EXTERNAL_ERROR' })

    const task = await prisma.task.findFirst({
      where: {
        userId: user.id,
        type: TASK_TYPE.MUSIC_GENERATE,
      },
      orderBy: { createdAt: 'desc' },
    })
    const balance = await prisma.userBalance.findUnique({ where: { userId: user.id } })
    const freeze = await prisma.balanceFreeze.findFirst({ orderBy: { createdAt: 'desc' } })

    expect(task).toMatchObject({
      status: 'failed',
      errorCode: 'ENQUEUE_FAILED',
    })
    expect(task?.billingInfo).toMatchObject({
      billable: true,
      status: 'rolled_back',
    })
    expect(balance?.balance).toBeCloseTo(10, 8)
    expect(balance?.frozenAmount).toBeCloseTo(0, 8)
    expect(freeze?.status).toBe('rolled_back')
  })
})
