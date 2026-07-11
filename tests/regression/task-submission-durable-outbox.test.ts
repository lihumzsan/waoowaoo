import { beforeEach, describe, expect, it, vi } from 'vitest'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { prisma } from '../helpers/prisma'
import { resetBillingState } from '../helpers/db-reset'
import { createTestProject, createTestUser, seedBalance } from '../helpers/billing-fixtures'

const addTaskJobMock = vi.hoisted(() => vi.fn(async () => {
  throw new Error('queue unavailable')
}))

vi.mock('@/lib/task/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/task/queues')>()),
  addTaskJob: addTaskJobMock,
}))

describe('regression - durable enqueue responsibility', () => {
  beforeEach(async () => {
    await resetBillingState()
    vi.clearAllMocks()
    process.env.BILLING_MODE = 'ENFORCE'
  })

  it('commits Task, freeze, event, and enqueue Outbox without a direct Redis write', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 10)

    const result = await submitTask({
      userId: user.id,
      locale: 'en',
      projectId: project.id,
      type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
      targetType: 'ProjectEditChapter',
      targetId: project.id,
      payload: { analysisModel: 'openrouter::openai/gpt-5.5', episodeId: 'episode-regression' },
    })

    const task = await prisma.task.findFirst({
      where: {
        userId: user.id,
        type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
      },
      orderBy: { createdAt: 'desc' },
    })
    const balance = await prisma.userBalance.findUnique({ where: { userId: user.id } })
    const freeze = await prisma.balanceFreeze.findFirst({ orderBy: { createdAt: 'desc' } })
    const commands = await prisma.outboxCommand.findMany({
      where: { aggregateType: 'task', aggregateId: result.taskId },
      orderBy: { kind: 'asc' },
    })

    expect(task).toMatchObject({
      status: 'queued',
      errorCode: null,
      enqueuedAt: null,
    })
    expect(task?.billingInfo).toMatchObject({
      billable: true,
      status: 'frozen',
    })
    const frozenAmount = balance?.frozenAmount.toNumber() ?? -1
    const availableBalance = balance?.balance.toNumber() ?? -1
    expect(frozenAmount).toBeCloseTo(freeze?.amount.toNumber() ?? -2, 8)
    expect(availableBalance).toBeCloseTo(10 - frozenAmount, 8)
    expect(availableBalance + frozenAmount).toBeCloseTo(10, 8)
    expect(freeze?.status).toBe('pending')
    expect(commands.map((command) => command.kind).sort()).toEqual([
      'task.enqueue',
      'task.lifecycle.broadcast',
    ])
    expect(addTaskJobMock).not.toHaveBeenCalled()
  })
})
