import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import {
  acceptOutboxCommand,
  claimOutboxCommand,
  createOutboxCommandInTransaction,
  deferOutboxCommand,
} from '@/lib/outbox/repository'
import {
  addOutboxJob,
  getOutboxQueue,
} from '@/lib/outbox/queue'
import {
  dispatchPendingOutboxCommands,
  dispatchCommittedOutboxCommands,
  reconcileStaleEnqueuedOutboxCommands,
} from '@/lib/outbox/dispatcher'
import { createOutboxWorker } from '@/lib/workers/outbox.worker'
import { resetBillingState } from '../../helpers/db-reset'
import { prisma } from '../../helpers/prisma'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { getImageQueue } from '@/lib/task/queues'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import {
  createWorkspaceResourceBroadcastsInTransaction,
  listWorkspaceResourceReplayEvents,
} from '@/lib/workspace-resource/resource-change-events'
import { invokeProjectAgentOperation } from '@/lib/operations/invocation'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { makeTestOperation } from '../../helpers/project-agent-operations'

async function createValidCommand(idempotencyKey: string) {
  return await prisma.$transaction(async (tx) => await createOutboxCommandInTransaction(tx, {
    idempotencyKey,
    aggregateType: 'task',
    aggregateId: `task-${idempotencyKey}`,
    payload: {
      kind: 'task.lifecycle.broadcast',
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

  it('immediately dispatches exact commands after their business transaction commits', async () => {
    const command = await createValidCommand('outbox-commit-fast-path')

    expect(await dispatchCommittedOutboxCommands([command.id])).toBe(1)
    await expect(prisma.outboxCommand.findUniqueOrThrow({ where: { id: command.id } }))
      .resolves.toMatchObject({ enqueuedAt: expect.any(Date), acceptedAt: null })
    await expect(getOutboxQueue().getJob(command.id)).resolves.toMatchObject({
      id: command.id,
      data: { outboxId: command.id },
    })
  })

  it('fast-dispatches the exact commands created by a transactional operation commit without a dispatcher cycle', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const operation = makeTestOperation({
      id: 'test_commit_fast_dispatch',
      channels: { tool: false, api: true },
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'project_data',
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ success: z.literal(true) }).strict(),
      executeInTransaction: async () => ({ success: true as const }),
    })
    const context = {
      request: new NextRequest('http://localhost/api/test-operation', { method: 'POST' }),
      userId: user.id,
      projectId: project.id,
      context: {},
      source: 'test',
      writer: null,
      toolCallId: null,
    } as unknown as ProjectAgentOperationContext

    await invokeProjectAgentOperation({
      registry: { [operation.id]: operation },
      channel: 'api',
      operationId: operation.id,
      context,
      input: {},
    })

    // No dispatcher cycle ran: the invocation owner itself must have handed
    // the exact committed command to the transport.
    const commands = await prisma.outboxCommand.findMany({
      where: { kind: 'workspace_resource.broadcast' },
    })
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({ enqueuedAt: expect.any(Date), acceptedAt: null })
    await expect(getOutboxQueue().getJob(commands[0].id)).resolves.toMatchObject({
      id: commands[0].id,
      data: { outboxId: commands[0].id },
    })
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

  it('does not consume the failure budget when expected contention defers delivery', async () => {
    const command = await createValidCommand('outbox-deferred-contention')
    await expect(claimOutboxCommand({
      id: command.id,
      leaseOwner: 'owner-deferred',
      leaseMs: 30_000,
    })).resolves.toMatchObject({ deliveryCount: 1 })

    await expect(deferOutboxCommand({
      id: command.id,
      leaseOwner: 'owner-deferred',
      retryAt: new Date(Date.now() + 2_000),
      reason: 'PROJECT_AGENT_CONTINUATION_DECISION_PENDING:test-run',
    })).resolves.toBe(true)
    await expect(prisma.outboxCommand.findUniqueOrThrow({ where: { id: command.id } }))
      .resolves.toMatchObject({
        deliveryCount: 0,
        acceptedAt: null,
        deadAt: null,
        enqueuedAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        // defer 不是失败,但原因必须留痕供事后诊断;最终 accept 时才清空。
        lastError: 'PROJECT_AGENT_CONTINUATION_DECISION_PENDING:test-run',
      })
  })

  it('dead-letters a poison payload on the first durable delivery attempt', async () => {
    const command = await prisma.outboxCommand.create({
      data: {
        kind: 'poison.command',
        idempotencyKey: 'outbox-poison',
        aggregateType: 'task',
        aggregateId: 'task-poison',
        payload: { kind: 'poison.command' },
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
        type: TASK_TYPE.CREATIVE_RESOURCE_IMAGE,
        targetType: 'CreativeResource',
        targetId: 'resource-generic-outbox',
        status: TASK_STATUS.QUEUED,
        payload: { resourceId: 'resource-generic-outbox', meta: { locale: 'en' } },
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

  it('commits resource replay with the business transaction and drops rolled-back notifications', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)

    await prisma.$transaction(async (tx) => {
      await createWorkspaceResourceBroadcastsInTransaction({
        tx,
        invocationId: 'resource-commit',
        userId: user.id,
        operationId: 'update_project_data',
        affectedResources: [{ kind: 'projectData', projectId: project.id }],
      })
    })

    await expect(prisma.$transaction(async (tx) => {
      await createWorkspaceResourceBroadcastsInTransaction({
        tx,
        invocationId: 'resource-rollback',
        userId: user.id,
        operationId: 'update_project_data',
        affectedResources: [{ kind: 'projectData', projectId: project.id }],
      })
      throw new Error('ROLLBACK_RESOURCE_NOTIFICATION')
    })).rejects.toThrow('ROLLBACK_RESOURCE_NOTIFICATION')

    const replay = await listWorkspaceResourceReplayEvents({
      projectId: project.id,
      userId: user.id,
      after: { createdAt: new Date(0), outboxId: '' },
    })
    expect(replay).toHaveLength(1)
    expect(replay[0]).toMatchObject({
      type: 'resource.changed',
      projectId: project.id,
      userId: user.id,
      affectedResources: [{ kind: 'projectData', projectId: project.id }],
    })
  })

  it('rolls back a resource write and compensates its prepared external artifact when execution fails before output', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const originalName = project.name
    let compensation: {
      prepared: unknown
      output: unknown
      error: unknown
    } | null = null
    const operation = makeTestOperation({
      id: 'test_external_resource_transaction_failure',
      channels: { tool: false, api: true },
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'project_data',
        billable: false,
        destructive: false,
        overwrite: true,
        bulk: false,
        externalSideEffects: true,
        longRunning: false,
      },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ success: z.literal(true) }).strict(),
      prepareTransaction: async () => ({ uniqueTemporaryKey: 'prepared-only-key' }),
      executeInTransaction: async (_ctx, _input, transaction, prepared) => {
        expect(prepared).toEqual({ uniqueTemporaryKey: 'prepared-only-key' })
        await transaction.project.update({
          where: { id: project.id },
          data: { name: 'must-roll-back' },
        })
        throw new Error('CONTROLLED_TRANSACTION_FAILURE')
      },
      compensateTransactionFailure: async (_ctx, _input, prepared, output, error) => {
        compensation = { prepared, output, error }
      },
    })
    const context = {
      request: new NextRequest('http://localhost/api/test-operation', { method: 'POST' }),
      userId: user.id,
      projectId: project.id,
      context: {},
      source: 'test',
      writer: null,
      toolCallId: null,
    } as unknown as ProjectAgentOperationContext

    await expect(invokeProjectAgentOperation({
      registry: { [operation.id]: operation },
      channel: 'api',
      operationId: operation.id,
      context,
      input: {},
    })).rejects.toThrow('CONTROLLED_TRANSACTION_FAILURE')

    await expect(prisma.project.findUniqueOrThrow({ where: { id: project.id } }))
      .resolves.toMatchObject({ name: originalName })
    await expect(prisma.outboxCommand.count()).resolves.toBe(0)
    expect(compensation).toMatchObject({
      prepared: { uniqueTemporaryKey: 'prepared-only-key' },
      output: null,
      error: expect.objectContaining({ message: 'CONTROLLED_TRANSACTION_FAILURE' }),
    })
  })

})
