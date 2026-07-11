import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { submitTask } from '@/lib/task/submitter'
import { TASK_EVENT_TYPE, TASK_TYPE } from '@/lib/task/types'
import { createTestProject, createTestUser, seedBalance } from '../helpers/billing-fixtures'
import { resetBillingState } from '../helpers/db-reset'
import { prisma } from '../helpers/prisma'

const addTaskJobMock = vi.hoisted(() => vi.fn(async () => {
  throw new Error('Redis queue unavailable during enqueue')
}))

vi.mock('@/lib/task/queues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/task/queues')>()),
  addTaskJob: addTaskJobMock,
}))

describe('system - durable Task submission', () => {
  const originalBillingMode = process.env.BILLING_MODE

  beforeEach(async () => {
    await resetBillingState()
    vi.clearAllMocks()
    process.env.BILLING_MODE = 'ENFORCE'
  })

  afterEach(() => {
    if (originalBillingMode === undefined) delete process.env.BILLING_MODE
    else process.env.BILLING_MODE = originalBillingMode
  })

  it('[P0:SYS-TASK-SUBMISSION-DURABLE-OUTBOX] persists Task, exact freeze, event, and enqueue Outbox without a synchronous Redis dependency', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 10)

    const submitted = await submitTask({
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
      dedupeKey: `system-durable-outbox:${project.id}`,
      operationId: 'generate_edit_script',
      operationSource: 'assistant',
      operationRequestId: `system-enqueue-request:${project.id}`,
    })

    const [tasks, balance, freezes, outbox] = await Promise.all([
      prisma.task.findMany({
        where: { userId: user.id, projectId: project.id },
        include: { events: { orderBy: { createdAt: 'asc' } } },
      }),
      prisma.userBalance.findUnique({ where: { userId: user.id } }),
      prisma.balanceFreeze.findMany({ where: { userId: user.id } }),
      prisma.outboxCommand.findMany({
        where: { aggregateType: 'task', aggregateId: submitted.taskId },
        orderBy: { kind: 'asc' },
      }),
    ])

    expect(tasks).toHaveLength(1)
    const task = tasks[0]
    expect(task).toMatchObject({
      id: submitted.taskId,
      status: 'queued',
      errorCode: null,
      enqueueAttempts: 0,
      lastEnqueueError: null,
      enqueuedAt: null,
      operationId: 'generate_edit_script',
      operationSource: 'assistant',
    })
    expect(task?.errorMessage).toBeNull()
    expect(task?.billingInfo).toMatchObject({
      billable: true,
      modeSnapshot: 'ENFORCE',
      status: 'frozen',
      freezeId: freezes[0]?.id,
    })
    expect(task?.events.map((event) => event.eventType)).toEqual([
      TASK_EVENT_TYPE.CREATED,
    ])

    expect(freezes).toHaveLength(1)
    expect(freezes[0]).toMatchObject({
      taskId: task?.id,
      status: 'pending',
    })
    const frozenAmount = freezes[0]?.amount.toNumber() ?? -1
    const availableBalance = balance?.balance.toNumber() ?? -1
    expect(balance?.frozenAmount.toNumber()).toBeCloseTo(frozenAmount, 8)
    expect(availableBalance).toBeCloseTo(10 - frozenAmount, 8)
    expect(availableBalance + frozenAmount).toBeCloseTo(10, 8)
    expect(balance?.totalSpent.toNumber()).toBeCloseTo(0, 8)
    expect(await prisma.balanceTransaction.count({ where: { userId: user.id } })).toBe(0)
    expect(outbox.map((command) => command.kind)).toEqual([
      'task.enqueue',
      'task.lifecycle.broadcast',
    ])
    expect(addTaskJobMock).not.toHaveBeenCalled()
  })
})
