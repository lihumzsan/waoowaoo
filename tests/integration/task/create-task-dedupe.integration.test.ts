import { beforeEach, describe, expect, it } from 'vitest'
import { TASK_STATUS, TASK_TYPE, type CreateTaskInput } from '@/lib/task/types'
import { tryUpdateTaskProgress } from '@/lib/task/service'
import { persistSubmittedTaskBatchInTransaction } from '@/lib/task/transactional-create'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function buildInput(params: {
  userId: string
  projectId: string
  suffix: string
}): CreateTaskInput {
  return {
    userId: params.userId,
    projectId: params.projectId,
    type: TASK_TYPE.WORKSPACE_RESOURCE_IMAGE,
    targetType: 'WorkspaceResource',
    targetId: `resource-${params.suffix}`,
    dedupeKey: `workspace-resource-image:${params.projectId}:${params.suffix}`,
    payload: {
      lifecycleProjection: {
        resources: [{
          resourceId: `resource-${params.suffix}`,
          mediaType: 'image',
          schemaId: 'generic.image',
          name: `Resource ${params.suffix}`,
        }],
      },
      resourceId: `resource-${params.suffix}`,
      prompt: `prompt-${params.suffix}`,
      meta: { locale: 'en' },
    },
    operationRequestId: `request-${params.suffix}`,
  }
}

async function persistBatch(
  inputs: readonly CreateTaskInput[],
  onBatchCreatedInTransaction?: Parameters<typeof persistSubmittedTaskBatchInTransaction>[0]['onBatchCreatedInTransaction'],
) {
  return await prisma.$transaction(async (tx) => await persistSubmittedTaskBatchInTransaction({
    tx,
    inputs,
    billingMode: 'OFF',
    onBatchCreatedInTransaction,
  }))
}

describe('transactional Task batch dedupe', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('creates the Task and its Created event in one transaction', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const input = buildInput({ userId: user.id, projectId: project.id, suffix: 'single' })

    const [created] = await persistBatch([input])

    expect(created).toMatchObject({ deduped: false, task: { status: TASK_STATUS.QUEUED } })
    await expect(prisma.taskEvent.count({ where: { taskId: created?.task.id } })).resolves.toBe(1)
  })

  it('strictly reuses an active Task only when its fingerprint and durable bundle match', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const input = buildInput({ userId: user.id, projectId: project.id, suffix: 'reuse' })
    const [first] = await persistBatch([input])

    const [replayed] = await persistBatch([input])

    expect(replayed).toMatchObject({ deduped: true, task: { id: first?.task.id } })
    await expect(prisma.task.count()).resolves.toBe(1)
    await expect(prisma.taskEvent.count()).resolves.toBe(1)
  })

  it('supports partial and all-deduped batches while preserving input order', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const firstInput = buildInput({ userId: user.id, projectId: project.id, suffix: 'first' })
    const secondInput = buildInput({ userId: user.id, projectId: project.id, suffix: 'second' })
    const [first] = await persistBatch([firstInput])

    const partial = await persistBatch([firstInput, secondInput])
    const replay = await persistBatch([firstInput, secondInput])

    expect(partial.map((entry) => entry.deduped)).toEqual([true, false])
    expect(partial[0]?.task.id).toBe(first?.task.id)
    expect(replay.map((entry) => entry.deduped)).toEqual([true, true])
    expect(replay.map((entry) => entry.task.id)).toEqual(partial.map((entry) => entry.task.id))
  })

  it('serializes concurrent submissions of the same dedupe identity into one durable bundle', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const input = buildInput({ userId: user.id, projectId: project.id, suffix: 'concurrent' })

    const results = await Promise.all([persistBatch([input]), persistBatch([input])])

    expect(results.map((batch) => batch[0]?.deduped).sort()).toEqual([false, true])
    expect(new Set(results.map((batch) => batch[0]?.task.id)).size).toBe(1)
    await expect(prisma.task.count()).resolves.toBe(1)
    await expect(prisma.taskEvent.count()).resolves.toBe(1)
  })

  it('fails closed on a terminal Task that still owns the dedupe key', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const input = buildInput({ userId: user.id, projectId: project.id, suffix: 'terminal' })
    const [created] = await persistBatch([input])
    await prisma.task.update({
      where: { id: created?.task.id },
      data: { status: TASK_STATUS.COMPLETED, finishedAt: new Date() },
    })

    await expect(persistBatch([input])).rejects.toThrow('TASK_BATCH_TERMINAL_DEDUPE_COLLISION')
    await expect(prisma.task.count()).resolves.toBe(1)
  })

  it('rechecks a deduped Task under row lock before binding it to new transactional work', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const input = buildInput({ userId: user.id, projectId: project.id, suffix: 'terminal-race' })
    const [created] = await persistBatch([input])
    if (!created) throw new Error('EXPECTED_TASK')

    await expect(prisma.$transaction(async (tx) => {
      await tx.task.findUniqueOrThrow({ where: { id: created.task.id } })
      await prisma.task.update({
        where: { id: created.task.id },
        data: { status: TASK_STATUS.COMPLETED, finishedAt: new Date() },
      })
      return await persistSubmittedTaskBatchInTransaction({
        tx,
        inputs: [{ ...input, id: created.task.id }],
        billingMode: 'OFF',
      })
    })).rejects.toThrow('TASK_BATCH_TERMINAL_DEDUPE_COLLISION')
  })

  it('fails closed when the same dedupe identity carries a different execution fingerprint', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const input = buildInput({ userId: user.id, projectId: project.id, suffix: 'conflict' })
    await persistBatch([input])

    await expect(persistBatch([{
      ...input,
      payload: {
        lifecycleProjection: {
          resources: [{
            resourceId: 'resource-conflict',
            mediaType: 'image',
            schemaId: 'generic.image',
            name: 'Conflicting resource',
          }],
        },
        resourceId: 'resource-conflict',
        prompt: 'different',
        meta: { locale: 'en' },
      },
    }])).rejects.toThrow('TASK_BATCH_IDENTITY_CONFLICT')
  })

  it('rolls back every Task and event when the batch callback fails', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const inputs = ['rollback-a', 'rollback-b'].map((suffix) => (
      buildInput({ userId: user.id, projectId: project.id, suffix })
    ))
    await expect(persistBatch(inputs, async (_tx, tasks) => {
      expect(tasks).toHaveLength(2)
      throw new Error('wait binding failed')
    })).rejects.toThrow('wait binding failed')

    await expect(prisma.task.count()).resolves.toBe(0)
    await expect(prisma.taskEvent.count()).resolves.toBe(0)
  })

  it('preserves Task input fields while updating current-attempt progress', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const task = await prisma.task.create({
      data: {
        userId: user.id,
        projectId: project.id,
        type: TASK_TYPE.WORKSPACE_RESOURCE_IMAGE,
        targetType: 'WorkspaceResource',
        targetId: 'resource-progress',
        status: TASK_STATUS.PROCESSING,
        attempt: 1,
        progress: 5,
        payload: {
          resourceId: 'resource-progress',
          imageModel: 'fal::image-model',
          referenceMode: 'asset',
          meta: { locale: 'zh', flowId: 'workspace_resource:image' },
          ui: { intent: 'generate', hasOutputAtStart: true },
        },
        queuedAt: new Date(),
        startedAt: new Date(),
      },
    })

    expect(await tryUpdateTaskProgress(task.id, 1, 18, {
      stage: 'generate_workspace_resource_image',
      externalPhase: 'running',
      streamRunId: 'event-only-stream',
      output: 'event-only-output',
      done: false,
      meta: { locale: 'zh' },
    })).toBe(true)
    const stored = await prisma.task.findUnique({
      where: { id: task.id },
      select: { payload: true, progress: true },
    })
    const payload = asRecord(stored?.payload)
    expect(stored?.progress).toBe(18)
    expect(payload).toMatchObject({
      stage: 'generate_workspace_resource_image',
      externalPhase: 'running',
      imageModel: 'fal::image-model',
      referenceMode: 'asset',
      meta: { locale: 'zh', flowId: 'workspace_resource:image' },
      ui: { intent: 'generate', hasOutputAtStart: true },
    })
    expect(payload).not.toHaveProperty('streamRunId')
    expect(payload).not.toHaveProperty('output')
    expect(payload).not.toHaveProperty('done')
  })

  it('rejects progress from a stale worker attempt without overwriting the current attempt', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const task = await prisma.task.create({
      data: {
        userId: user.id,
        projectId: project.id,
        type: TASK_TYPE.WORKSPACE_RESOURCE_IMAGE,
        targetType: 'WorkspaceResource',
        targetId: 'resource-stale-attempt',
        status: TASK_STATUS.PROCESSING,
        attempt: 2,
        progress: 40,
        payload: { meta: { locale: 'zh' }, stage: 'current-attempt' },
        queuedAt: new Date(),
        startedAt: new Date(),
      },
    })

    expect(await tryUpdateTaskProgress(task.id, 1, 90, { stage: 'stale-attempt' })).toBe(false)
    await expect(prisma.task.findUnique({ where: { id: task.id } })).resolves.toMatchObject({
      attempt: 2,
      progress: 40,
      payload: { meta: { locale: 'zh' }, stage: 'current-attempt' },
    })
  })
})
