import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acceptOutboxCommand,
  claimOutboxCommand,
  createOutboxCommandInTransaction,
} from '@/lib/outbox/repository'
import {
  addOutboxJob,
  getOutboxQueue,
} from '@/lib/outbox/queue'
import {
  dispatchPendingOutboxCommands,
  reconcileStaleEnqueuedOutboxCommands,
} from '@/lib/outbox/dispatcher'
import { createOutboxWorker } from '@/lib/workers/outbox.worker'
import { resetBillingState } from '../../helpers/db-reset'
import { prisma } from '../../helpers/prisma'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { getImageQueue } from '@/lib/task/queues'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'

async function createValidCommand(idempotencyKey: string) {
  return await prisma.$transaction(async (tx) => await createOutboxCommandInTransaction(tx, {
    idempotencyKey,
    aggregateType: 'task',
    aggregateId: `task-${idempotencyKey}`,
    payload: {
      kind: 'task.lifecycle.broadcast',
      version: 1,
      eventId: 1,
      taskId: `task-${idempotencyKey}`,
    },
  }))
}

describe('durable Outbox delivery lifecycle', () => {
  beforeEach(async () => {
    await getOutboxQueue().obliterate({ force: true })
    await getImageQueue().obliterate({ force: true })
    await prisma.outboxCommand.deleteMany()
    await resetBillingState()
  })

  it('recovers add-before-mark and reuses one fixed BullMQ job identity', async () => {
    const command = await createValidCommand('outbox-add-before-mark')
    const first = await addOutboxJob(command.id)
    const second = await addOutboxJob(command.id)
    expect(first.id).toBe(command.id)
    expect(second.id).toBe(command.id)
    expect(await getOutboxQueue().getJobs(['waiting', 'delayed', 'active'])).toHaveLength(1)

    expect(await dispatchPendingOutboxCommands()).toBe(1)
    await expect(prisma.outboxCommand.findUniqueOrThrow({ where: { id: command.id } }))
      .resolves.toMatchObject({ enqueuedAt: expect.any(Date), acceptedAt: null })
    expect(await getOutboxQueue().getJobs(['waiting', 'delayed', 'active'])).toHaveLength(1)
  })

  it('resets stale enqueued state only when the Redis job is truly absent', async () => {
    const command = await createValidCommand('outbox-job-lost')
    await prisma.outboxCommand.update({
      where: { id: command.id },
      data: { enqueuedAt: new Date(Date.now() - 120_000) },
    })

    expect(await reconcileStaleEnqueuedOutboxCommands()).toBe(1)
    await expect(prisma.outboxCommand.findUniqueOrThrow({ where: { id: command.id } }))
      .resolves.toMatchObject({ enqueuedAt: null, acceptedAt: null, deadAt: null })
  })

  it('reclaims an expired DB lease and rejects the stale owner finalize', async () => {
    const command = await createValidCommand('outbox-lease-reclaim')
    const first = await claimOutboxCommand({ id: command.id, leaseOwner: 'owner-old', leaseMs: 1_000 })
    expect(first).toMatchObject({ leaseOwner: 'owner-old', deliveryCount: 1 })
    await expect(claimOutboxCommand({ id: command.id, leaseOwner: 'owner-new', leaseMs: 1_000 }))
      .resolves.toBeNull()

    await prisma.outboxCommand.update({
      where: { id: command.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1) },
    })
    const reclaimed = await claimOutboxCommand({ id: command.id, leaseOwner: 'owner-new', leaseMs: 1_000 })
    expect(reclaimed).toMatchObject({ leaseOwner: 'owner-new', deliveryCount: 2 })
    await expect(acceptOutboxCommand({ id: command.id, leaseOwner: 'owner-old' })).resolves.toBe(false)
    await expect(acceptOutboxCommand({ id: command.id, leaseOwner: 'owner-new' })).resolves.toBe(true)
  })

  it('dead-letters a poison payload on the first durable delivery attempt', async () => {
    const command = await prisma.outboxCommand.create({
      data: {
        kind: 'poison.command',
        version: 1,
        idempotencyKey: 'outbox-poison',
        aggregateType: 'task',
        aggregateId: 'task-poison',
        payload: { kind: 'poison.command', version: 1 },
      },
    })
    const worker = createOutboxWorker()
    try {
      expect(await dispatchPendingOutboxCommands()).toBe(1)
      await vi.waitFor(async () => {
        const row = await prisma.outboxCommand.findUniqueOrThrow({ where: { id: command.id } })
        expect(row).toMatchObject({
          deliveryCount: 1,
          acceptedAt: null,
          deadAt: expect.any(Date),
          lastError: expect.stringContaining('OUTBOX_COMMAND_KIND_UNSUPPORTED'),
        })
      }, { timeout: 10_000, interval: 50 })
    } finally {
      await worker.close()
    }
  })

  it('delivers a generic task.enqueue command without an OperationExecution authority', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const task = await prisma.task.create({
      data: {
        userId: user.id,
        projectId: project.id,
        type: TASK_TYPE.IMAGE_PANEL,
        targetType: 'ProjectPanel',
        targetId: 'panel-generic-outbox',
        status: TASK_STATUS.QUEUED,
        payload: { panelId: 'panel-generic-outbox', meta: { locale: 'en' } },
        executionFingerprint: 'a'.repeat(64),
        queuedAt: new Date(),
      },
    })
    const command = await prisma.$transaction(async (tx) => await createOutboxCommandInTransaction(tx, {
      idempotencyKey: `task-enqueue:${task.id}`,
      aggregateType: 'task',
      aggregateId: task.id,
      payload: {
        kind: 'task.enqueue',
        version: 1,
        taskId: task.id,
        operationExecutionId: null,
      },
    }))
    const worker = createOutboxWorker()
    try {
      expect(await dispatchPendingOutboxCommands()).toBe(1)
      await vi.waitFor(async () => {
        await expect(prisma.outboxCommand.findUniqueOrThrow({ where: { id: command.id } }))
          .resolves.toMatchObject({ acceptedAt: expect.any(Date), deliveryCount: 1 })
      }, { timeout: 10_000, interval: 50 })
      await expect(prisma.task.findUniqueOrThrow({ where: { id: task.id } }))
        .resolves.toMatchObject({ status: TASK_STATUS.QUEUED, enqueuedAt: expect.any(Date) })
      await expect(getImageQueue().getJob(task.id)).resolves.toMatchObject({ id: task.id })
    } finally {
      await worker.close()
    }
  })

})
