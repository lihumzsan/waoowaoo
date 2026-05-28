import { beforeEach, describe, expect, it, vi } from 'vitest'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestUser } from '../../helpers/task-fixtures'

const queueState = vi.hoisted(() => ({
  mode: 'success' as 'success' | 'fail',
  errorMessage: 'queue add failed',
}))
const addTaskJobMock = vi.hoisted(() => vi.fn(async () => ({ id: 'mock-job' })))
const publishTaskEventMock = vi.hoisted(() => vi.fn(async () => ({})))

vi.mock('@/lib/task/queues', () => ({
  addTaskJob: addTaskJobMock,
}))

vi.mock('@/lib/task/publisher', () => ({
  publishTaskEvent: publishTaskEventMock,
}))

addTaskJobMock.mockImplementation(async () => {
  if (queueState.mode === 'fail') {
    throw new Error(queueState.errorMessage)
  }
  return { id: 'mock-job' }
})

describe('task submitter without billing', () => {
  beforeEach(async () => {
    await resetBillingState()
    process.env.BILLING_MODE = 'ENFORCE'
    queueState.mode = 'success'
    queueState.errorMessage = 'queue add failed'
    vi.clearAllMocks()
  })

  it('stores null billing info for formerly billable tasks', async () => {
    const user = await createTestUser()

    const result = await submitTask({
      userId: user.id,
      locale: 'en',
      projectId: 'project-no-billing-a',
      type: TASK_TYPE.VOICE_LINE,
      targetType: 'VoiceLine',
      targetId: 'line-no-billing-a',
      payload: { maxSeconds: 10 },
    })

    expect(result.success).toBe(true)
    const task = await prisma.task.findUnique({ where: { id: result.taskId } })
    expect(task?.billingInfo).toBeNull()
    expect(await prisma.balanceFreeze.count()).toBe(0)
    expect(await prisma.balanceTransaction.count()).toBe(0)
    expect(await prisma.usageCost.count()).toBe(0)
  })

  it('ignores caller-provided billing info', async () => {
    const user = await createTestUser()

    const result = await submitTask({
      userId: user.id,
      locale: 'en',
      projectId: 'project-no-billing-b',
      type: TASK_TYPE.VIDEO_PANEL,
      targetType: 'NovelPromotionPanel',
      targetId: 'panel-no-billing-b',
      payload: { videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2' },
      billingInfo: {
        billable: true,
        source: 'task',
        taskType: TASK_TYPE.VIDEO_PANEL,
        apiType: 'video',
        model: 'legacy-model',
        quantity: 1,
        unit: 'video',
        maxFrozenCost: 100,
        action: TASK_TYPE.VIDEO_PANEL,
        status: 'quoted',
      },
    } as Parameters<typeof submitTask>[0] & { billingInfo: unknown })

    expect(result.success).toBe(true)
    const task = await prisma.task.findUnique({ where: { id: result.taskId } })
    expect(task?.billingInfo).toBeNull()
    expect(await prisma.balanceFreeze.count()).toBe(0)
  })

  it('does not create freeze records when queue enqueue fails', async () => {
    const user = await createTestUser()
    queueState.mode = 'fail'
    queueState.errorMessage = 'queue unavailable'

    await expect(
      submitTask({
        userId: user.id,
        locale: 'en',
        projectId: 'project-no-billing-c',
        type: TASK_TYPE.VOICE_LINE,
        targetType: 'VoiceLine',
        targetId: 'line-no-billing-c',
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
  })
})
