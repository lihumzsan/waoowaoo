import { beforeEach, describe, expect, it, vi } from 'vitest'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { prisma } from '../helpers/prisma'
import { resetBillingState } from '../helpers/db-reset'
import { createTestProject, createTestUser, seedBalance } from '../helpers/billing-fixtures'

const queueState = vi.hoisted(() => ({
  message: 'queue add failed',
}))

vi.mock('@/lib/task/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/task/queues')>()),
  addTaskJob: vi.fn(async () => {
    throw new Error(queueState.message)
  }),
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
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 10)

    await expect(
      submitTask({
        userId: user.id,
        locale: 'en',
        projectId: project.id,
        type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
        targetType: 'ProjectEditChapter',
        targetId: project.id,
        payload: { analysisModel: 'openrouter::openai/gpt-5.5', episodeId: 'episode-regression' },
      }),
    ).rejects.toMatchObject({ code: 'EXTERNAL_ERROR' })

    const task = await prisma.task.findFirst({
      where: {
        userId: user.id,
        type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
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
