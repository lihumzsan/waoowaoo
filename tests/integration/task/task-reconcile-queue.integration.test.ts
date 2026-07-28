import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Queue, QueueEvents, Worker } from 'bullmq'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { observeTaskJobAcrossQueues, reconcileActiveTasks } from '@/lib/task/reconcile'
import { buildTaskJobEnvelope } from '@/lib/task/job-envelope'
import { getVideoQueue, QUEUE_NAME, removeTaskJob } from '@/lib/task/queues'
import { queueRedis } from '@/lib/redis'
import { TASK_STATUS, TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { withTaskLifecycle } from '@/lib/workers/shared'
import { buildCreativeResourceId } from '@/lib/creative-resource/identity'

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
    await prisma.creativeResource.create({
      data: {
        id: 'resource-recovery-1',
        userId: user.id,
        projectId: project.id,
        scopeKind: 'project',
        scopeId: project.id,
        mediaType: 'video',
        schemaId: 'generic.video',
        name: 'Queued recovery resource',
      },
    })
    const parent = await prisma.task.create({
      data: {
        userId: user.id,
        projectId: project.id,
        type: TASK_TYPE.CREATIVE_WORK,
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
      taskType: TASK_TYPE.CREATIVE_RESOURCE_VIDEO,
      apiType: 'video' as const,
      model: 'kling::video-model',
      quantity: 2,
      unit: 'video' as const,
      maxFrozenCost: 4,
      action: 'generate_creative_resource_video',
      freezeId: 'freeze-recovery-1',
      status: 'frozen' as const,
    }
    const payload = {
      resourceId: 'resource-recovery-1',
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
        type: TASK_TYPE.CREATIVE_RESOURCE_VIDEO,
        targetType: 'CreativeResource',
        targetId: 'resource-recovery-1',
        status: TASK_STATUS.QUEUED,
        payload,
        batchKey: 'batch-recovery-1',
        billingInfo,
        priority: 8,
        operationId: 'generate_creative_resource_video',
        operationSource: 'assistant',
        approvalGrantId: null,
        operationExecutionId: null,
        operationPlanTaskId: null,
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
      type: TASK_TYPE.CREATIVE_RESOURCE_VIDEO,
      locale: 'zh',
      projectId: project.id,
      episodeId: null,
      targetType: 'CreativeResource',
      targetId: 'resource-recovery-1',
      payload,
      batchKey: 'batch-recovery-1',
      billingInfo,
      userId: user.id,
      operationId: 'generate_creative_resource_video',
      operationSource: 'assistant',
      approvalGrantId: null,
      operationExecutionId: null,
      operationPlanTaskId: null,
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

  it('recovers a processing CreativeResource video task without mutating its resource', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const episode = await prisma.projectEpisode.create({
      data: {
        projectId: project.id,
        episodeNumber: 1,
        name: 'Episode 1',
      },
    })
    const resourceId = buildCreativeResourceId({
      operationId: 'create_video',
      requestId: `task-reconcile:${episode.id}`,
      candidateIndex: 0,
    })
    const resource = await prisma.creativeResource.create({
      data: {
        id: resourceId,
        userId: user.id,
        projectId: project.id,
        episodeId: episode.id,
        scopeKind: 'episode',
        scopeId: episode.id,
        mediaType: 'video',
        schemaId: 'generic.video',
        name: 'Recovered video resource',
        status: 'processing',
      },
    })
    const staleAt = new Date(Date.now() - 120_000)
    const task = await prisma.task.create({
      data: {
        userId: user.id,
        projectId: project.id,
        episodeId: episode.id,
        type: TASK_TYPE.CREATIVE_RESOURCE_VIDEO,
        targetType: 'CreativeResource',
        targetId: resource.id,
        status: TASK_STATUS.PROCESSING,
        progress: 51,
        attempt: 1,
        externalId: 'OPENROUTER:VIDEO:provider-completed-task',
        payload: {
          resourceId: resource.id,
          episodeId: episode.id,
          videoModel: 'openrouter::video-model',
          meta: { locale: 'zh' },
        },
        executionFingerprint: 'processing-video-recovery-fingerprint',
        billingInfo: { billable: false, source: 'task', status: 'skipped' },
        queuedAt: staleAt,
        startedAt: staleAt,
        heartbeatAt: staleAt,
      },
    })
    queuedJobIds.push(task.id)

    const queue = getVideoQueue()
    const events = new QueueEvents(QUEUE_NAME.VIDEO, { connection: queueRedis })
    let handlerEntered = false
    const staleDeliveryWorker = new Worker<TaskJobData>(
      QUEUE_NAME.VIDEO,
      async (job) => await withTaskLifecycle(job, async () => {
        handlerEntered = true
        return { unexpected: true }
      }),
      { connection: queueRedis, concurrency: 1 },
    )
    let workerClosed = false
    try {
      await Promise.all([events.waitUntilReady(), staleDeliveryWorker.waitUntilReady()])
      const envelope = buildTaskJobEnvelope(task)
      const terminalJob = await queue.add(task.type, envelope.data, { jobId: task.id })
      await expect(terminalJob.waitUntilFinished(events)).rejects.toThrow('TASK_ATTEMPT_ALREADY_PROCESSING')
      expect(handlerEntered).toBe(false)
      await staleDeliveryWorker.close()
      workerClosed = true
      await prisma.task.update({
        where: { id: task.id },
        data: { updatedAt: staleAt },
      })

      const result = await reconcileActiveTasks([queue])
      const recoveredTask = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
      const recoveredResource = await prisma.creativeResource.findUniqueOrThrow({ where: { id: resource.id } })
      const recoveredJob = await queue.getJob(task.id)

      expect(result).toEqual({
        failedTaskIds: [],
        recoveredTaskIds: [task.id],
        unavailableTaskIds: [],
      })
      expect(recoveredTask).toMatchObject({
        status: TASK_STATUS.QUEUED,
        progress: 51,
        attempt: 1,
        externalId: 'OPENROUTER:VIDEO:provider-completed-task',
        startedAt: null,
        heartbeatAt: null,
        finishedAt: null,
        errorCode: null,
        errorMessage: null,
        billingInfo: { billable: false, source: 'task', status: 'skipped' },
      })
      expect(recoveredResource).toMatchObject({
        status: 'processing',
        materializedAt: null,
        errorCode: null,
        errorMessage: null,
      })
      expect(recoveredJob).not.toBeNull()
      await expect(recoveredJob!.getState()).resolves.toBe('waiting')
    } finally {
      if (!workerClosed) await staleDeliveryWorker.close()
      await events.close()
    }
  })
})
