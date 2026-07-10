import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Queue } from 'bullmq'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { observeTaskJobAcrossQueues, reconcileActiveTasks } from '@/lib/task/reconcile'
import { getVideoQueue, removeTaskJob } from '@/lib/task/queues'
import { TASK_STATUS, TASK_TYPE, type TaskJobData } from '@/lib/task/types'

describe('task reconciler DB and Redis integration', () => {
  const queuedJobIds: string[] = []

  beforeEach(async () => {
    await resetBillingState()
    queuedJobIds.length = 0
  })

  afterEach(async () => {
    await Promise.all(queuedJobIds.map(async (taskId) => {
      await removeTaskJob(taskId)
    }))
  })

  it('reconstructs an absent queued job from the complete durable DB envelope', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const parent = await prisma.task.create({
      data: {
        userId: user.id,
        projectId: project.id,
        type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
        targetType: 'Project',
        targetId: project.id,
        status: TASK_STATUS.COMPLETED,
        payload: { meta: { locale: 'zh' } },
        queuedAt: new Date(),
        finishedAt: new Date(),
      },
    })
    const billingInfo = {
      billable: true as const,
      source: 'task' as const,
      taskType: TASK_TYPE.VIDEO_GROUP,
      apiType: 'video' as const,
      model: 'kling::video-model',
      quantity: 2,
      unit: 'video' as const,
      maxFrozenCost: 4,
      action: 'generate_video_group',
      freezeId: 'freeze-recovery-1',
      status: 'frozen' as const,
    }
    const payload = {
      groupId: 'group-recovery-1',
      meta: {
        locale: 'zh',
        trace: { requestId: 'request-recovery-1' },
      },
    }
    const task = await prisma.task.create({
      data: {
        userId: user.id,
        projectId: project.id,
        parentTaskId: parent.id,
        episodeId: null,
        type: TASK_TYPE.VIDEO_GROUP,
        targetType: 'ProjectVideoGroup',
        targetId: 'group-recovery-1',
        status: TASK_STATUS.QUEUED,
        payload,
        batchKey: 'batch-recovery-1',
        billingInfo,
        priority: 8,
        operationId: 'generate_video_group',
        operationSource: 'assistant',
        operationConfirmed: true,
        operationRequestId: 'operation-request-recovery-1',
        queuedAt: new Date(Date.now() - 60_000),
      },
    })
    queuedJobIds.push(task.id)
    await prisma.task.update({
      where: { id: task.id },
      data: { updatedAt: new Date(Date.now() - 60_000) },
    })

    const result = await reconcileActiveTasks()
    const job = await getVideoQueue().getJob(task.id)
    const stored = await prisma.task.findUnique({ where: { id: task.id } })

    expect(result).toEqual({
      failedTaskIds: [],
      recoveredTaskIds: [task.id],
      unavailableTaskIds: [],
    })
    expect(stored).toMatchObject({
      id: task.id,
      status: TASK_STATUS.QUEUED,
      dedupeKey: null,
      billingInfo,
      enqueueAttempts: 0,
      lastEnqueueError: null,
    })
    expect(stored?.enqueuedAt).toBeInstanceOf(Date)
    expect(job?.opts.priority).toBe(8)
    expect(job?.data).toEqual({
      taskId: task.id,
      parentTaskId: parent.id,
      type: TASK_TYPE.VIDEO_GROUP,
      locale: 'zh',
      projectId: project.id,
      episodeId: null,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-recovery-1',
      payload,
      batchKey: 'batch-recovery-1',
      billingInfo,
      userId: user.id,
      operationId: 'generate_video_group',
      operationSource: 'assistant',
      operationConfirmed: true,
      operationRequestId: 'operation-request-recovery-1',
      trace: { requestId: 'request-recovery-1' },
    })
  })

  it('classifies a real Redis connection failure as unavailable rather than absent', async () => {
    const unavailableQueue = new Queue<TaskJobData>('task-observation-unavailable-test', {
      connection: {
        host: '127.0.0.1',
        port: 1,
        connectTimeout: 100,
        maxRetriesPerRequest: null,
        retryStrategy: () => null,
      },
    })

    try {
      await expect(observeTaskJobAcrossQueues('task-unavailable', [unavailableQueue]))
        .resolves.toBe('unavailable')
    } finally {
      await unavailableQueue.close()
    }
  })
})
