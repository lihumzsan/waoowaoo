import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiError } from '@/lib/api-errors'
import { buildDefaultTaskBillingInfo } from '@/lib/billing/task-policy'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestUser, seedBalance } from '../../helpers/billing-fixtures'

describe('billing/submitter integration', () => {
  beforeEach(async () => {
    await resetBillingState()
    process.env.BILLING_MODE = 'ENFORCE'
    vi.clearAllMocks()
  })

  it('builds billing info server-side for billable task submission', async () => {
    const user = await createTestUser()
    await seedBalance(user.id, 10)

    const result = await submitTask({
      userId: user.id,
      locale: 'en',
      projectId: 'project-a',
      type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
      targetType: 'ProjectEditChapter',
      targetId: 'project-a',
      payload: { analysisModel: 'openrouter::openai/gpt-5.5', episodeId: 'episode-a' },
    })

    expect(result.success).toBe(true)
    const task = await prisma.task.findUnique({ where: { id: result.taskId } })
    expect(task).toBeTruthy()
    const billing = task?.billingInfo as { billable?: boolean; source?: string } | null
    expect(billing?.billable).toBe(true)
    expect(billing?.source).toBe('task')
    await expect(prisma.taskEvent.count({ where: { taskId: result.taskId } })).resolves.toBe(1)
    await expect(prisma.outboxCommand.count({
      where: { aggregateType: 'task', aggregateId: result.taskId },
    })).resolves.toBe(2)
  })

  it('marks task as failed when balance is insufficient', async () => {
    const user = await createTestUser()
    await seedBalance(user.id, 0)

    const billingInfo = buildDefaultTaskBillingInfo(TASK_TYPE.EDIT_SCRIPT_GENERATE, {
      analysisModel: 'openrouter::openai/gpt-5.5',
      episodeId: 'episode-b',
    })
    expect(billingInfo?.billable).toBe(true)

    await expect(
      submitTask({
        userId: user.id,
        locale: 'en',
        projectId: 'project-b',
        type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
        targetType: 'ProjectEditChapter',
        targetId: 'project-b',
        payload: { analysisModel: 'openrouter::openai/gpt-5.5', episodeId: 'episode-b' },
        billingInfo,
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' } satisfies Pick<ApiError, 'code'>)

    const task = await prisma.task.findFirst({
      where: {
        userId: user.id,
        type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
      },
      orderBy: { createdAt: 'desc' },
    })

    expect(task).toBeNull()
    await expect(prisma.balanceFreeze.count()).resolves.toBe(0)
  })

  it('allows billable task submission without computed billingInfo in OFF mode (regression)', async () => {
    process.env.BILLING_MODE = 'OFF'
    const user = await createTestUser()

    const result = await submitTask({
      userId: user.id,
      locale: 'en',
      projectId: 'project-c',
      type: TASK_TYPE.IMAGE_CHARACTER,
      targetType: 'CharacterAppearance',
      targetId: 'appearance-c',
      payload: {},
    })

    expect(result.success).toBe(true)
    const task = await prisma.task.findUnique({ where: { id: result.taskId } })
    expect(task).toBeTruthy()
    expect(task?.errorCode).toBeNull()
    expect(task?.billingInfo).toBeNull()
  })

  it('keeps strict billingInfo validation in ENFORCE mode (regression)', async () => {
    process.env.BILLING_MODE = 'ENFORCE'
    const user = await createTestUser()
    await seedBalance(user.id, 10)

    await expect(
      submitTask({
        userId: user.id,
        locale: 'en',
        projectId: 'project-d',
        type: TASK_TYPE.IMAGE_CHARACTER,
        targetType: 'CharacterAppearance',
        targetId: 'appearance-d',
        payload: {},
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' } satisfies Pick<ApiError, 'code'>)

    const task = await prisma.task.findFirst({
      where: {
        userId: user.id,
        type: TASK_TYPE.IMAGE_CHARACTER,
      },
      orderBy: { createdAt: 'desc' },
    })

    expect(task).toBeNull()
  })

  it('rolls back Task, billing freeze, event, and Outbox when the submission transaction fails', async () => {
    const user = await createTestUser()
    await seedBalance(user.id, 10)
    const eventCountBefore = await prisma.taskEvent.count()
    const outboxCountBefore = await prisma.outboxCommand.count()

    await expect(
      submitTask({
        userId: user.id,
        locale: 'en',
        projectId: 'project-e',
        type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
        targetType: 'ProjectEditChapter',
        targetId: 'project-e',
        payload: { analysisModel: 'openrouter::openai/gpt-5.5', episodeId: 'episode-e' },
        onTaskCreatedInTransaction: async () => {
          throw new Error('target ownership failed')
        },
      }),
    ).rejects.toThrow('target ownership failed')

    const task = await prisma.task.findFirst({
      where: {
        userId: user.id,
        type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
      },
      orderBy: { createdAt: 'desc' },
    })
    const balance = await prisma.userBalance.findUnique({ where: { userId: user.id } })

    expect(task).toBeNull()
    expect(balance?.balance).toBeCloseTo(10, 8)
    expect(balance?.frozenAmount).toBeCloseTo(0, 8)
    expect(await prisma.balanceFreeze.count()).toBe(0)
    expect(await prisma.taskEvent.count()).toBe(eventCountBefore)
    expect(await prisma.outboxCommand.count()).toBe(outboxCountBefore)
  })

})
