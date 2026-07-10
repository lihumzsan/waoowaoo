import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser, seedBalance } from '../../helpers/billing-fixtures'
import { persistOperationPlanSnapshot } from '@/lib/operations/operation-plan-snapshot'
import { invokeApprovedOperationPlan, issueApprovalGrant } from '@/lib/operations/planned-operation-invocation'
import { submitApprovedOperationPlanTasks } from '@/lib/task/approved-plan-submitter'
import { TASK_TYPE, type TaskBillingInfo } from '@/lib/task/types'
import type { BillingQuoteView, OperationPlan } from '@/lib/operations/planning'
import { makeTestOperation, EFFECTS_BILLABLE } from '../../helpers/project-agent-operations'
import { z } from 'zod'
import { enqueuePersistedApprovedTask } from '@/lib/task/enqueue'
import { observeTaskJob } from '@/lib/task/reconcile'
import { removeTaskJob } from '@/lib/task/queues'
function billingInfo(id: string): TaskBillingInfo {
  return {
    billable: true,
    source: 'task',
    taskType: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
    apiType: 'image',
    model: 'fal::gpt-image-2',
    quantity: 1,
    unit: 'image',
    maxFrozenCost: 1,
    action: `style-preview-${id}`,
  }
}
async function seedExecution(balance: number) {
  const user = await createTestUser()
  const project = await createTestProject(user.id)
  await seedBalance(user.id, balance)
  const plan: OperationPlan = {
    kind: 'task_submission',
    operationId: 'generate_edit_style_previews',
    projectId: project.id,
    userId: user.id,
    tasks: ['preview-1', 'preview-2'].map((id) => ({ id: `plan-${id}`,
      taskType: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
      target: { targetType: 'ProjectEditStylePreview', targetId: id },
      payload: { stylePreviewId: id, imageModel: 'fal::gpt-image-2' },
      billingInfo: billingInfo(id),
      locale: 'en',
      episodeId: null,
      dedupeKey: `style-preview:${id}`,
      priority: 0,
    })),
  }
  const quote: BillingQuoteView = {
    showCredits: true,
    billingMode: 'ENFORCE',
    billable: true,
    taskCount: 2,
    mediaTaskCount: 2,
    totalMaxFrozenCost: 2,
    currency: 'credits',
    items: plan.tasks.map((task) => ({
      id: task.id,
      taskType: task.taskType,
      targetType: task.target.targetType,
      targetId: task.target.targetId,
      apiType: 'image',
      model: 'fal::gpt-image-2',
      quantity: 1,
      unit: 'image',
      maxFrozenCost: 1,
    })),
  }
  const snapshot = await persistOperationPlanSnapshot({
    plan,
    normalizedInput: { episodeId: null },
    quote,
  })
  const issued = await issueApprovalGrant({
    userId: user.id,
    planSnapshotId: snapshot.id,
    requestId: 'approved-request-1',
  })
  const execution = await prisma.operationExecution.create({
    data: {
      id: 'approved-execution-1',
      contractVersion: 1,
      userId: user.id,
      scopeKind: 'project',
      scopeId: project.id,
      projectId: project.id,
      operationId: plan.operationId,
      planSnapshotId: snapshot.id,
      approvalGrantId: issued.approvalGrantId,
      requestId: issued.operationRequestId,
      status: 'committing',
    },
  })
  return { user, project, plan, snapshot, issued, execution }
}
function createApprovedBatchOperation(plan: OperationPlan, afterSubmit?: () => Promise<void>) {
  return makeTestOperation({
    id: plan.operationId,
    summary: 'approved batch integration',
    intent: 'act',
    effects: EFFECTS_BILLABLE,
    confirmation: { kind: 'billable_media', required: true },
    inputSchema: z.object({ episodeId: z.null() }),
    outputSchema: z.object({ taskIds: z.array(z.string()) }),
    plan: async () => plan,
    commit: async (ctx) => {
      if (!ctx.executionAuthorization) throw new Error('EXPECTED_EXECUTION_AUTHORIZATION')
      const tasks = await submitApprovedOperationPlanTasks({
        ...ctx.executionAuthorization,
        operationSource: ctx.source,
      })
      await afterSubmit?.()
      return { taskIds: [...tasks.values()].map((task) => task.taskId) }
    },
  })
}
describe('approved operation plan Task batch integration', () => {
  const queuedTaskIds: string[] = []
  beforeEach(async () => {
    await resetBillingState()
    await prisma.outboxCommand.deleteMany()
    await prisma.operationExecution.deleteMany()
    await prisma.approvalGrant.deleteMany()
    await prisma.operationPlanSnapshot.deleteMany()
    process.env.BILLING_MODE = 'ENFORCE'
    queuedTaskIds.length = 0
  })
  afterEach(async () => {
    await Promise.all(
      queuedTaskIds.map(async (taskId) => {
        await removeTaskJob(taskId)
      }),
    )
  })
  it('atomically consumes one Grant, freezes every Task, and creates durable enqueue responsibility', async () => {
    const seeded = await seedExecution(10)
    const results = await prisma.$transaction(
      async (transaction) =>
        await submitApprovedOperationPlanTasks({
          approvalGrantId: seeded.issued.approvalGrantId,
          operationExecutionId: seeded.execution.id,
          transaction,
          operationSource: 'assistant-panel',
        }),
    )
    expect([...results.keys()].sort()).toEqual(['plan-preview-1', 'plan-preview-2'])
    const [grant, execution, tasks, freezes, commands] = await Promise.all([
      prisma.approvalGrant.findUnique({
        where: { id: seeded.issued.approvalGrantId },
      }),
      prisma.operationExecution.findUnique({
        where: { id: seeded.execution.id },
      }),
      prisma.task.findMany({
        where: { operationExecutionId: seeded.execution.id },
        orderBy: { operationPlanTaskId: 'asc' },
      }),
      prisma.balanceFreeze.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.outboxCommand.findMany({ orderBy: { createdAt: 'asc' } }),
    ])
    expect(grant).toMatchObject({
      version: 1,
      consumedExecutionId: seeded.execution.id,
    })
    expect(grant?.consumedAt).toBeInstanceOf(Date)
    expect(execution?.status).toBe('committing')
    expect(tasks).toHaveLength(2)
    expect(tasks.map((task) => task.operationPlanTaskId)).toEqual(['plan-preview-1', 'plan-preview-2'])
    expect(tasks.every((task) => task.approvalGrantId === seeded.issued.approvalGrantId)).toBe(true)
    expect(tasks.every((task) => (task.billingInfo as { status?: string }).status === 'frozen')).toBe(true)
    expect(freezes).toHaveLength(2)
    expect(freezes.every((freeze) => freeze.status === 'pending')).toBe(true)
    expect(commands.filter((command) => command.kind === 'task.lifecycle.broadcast')).toHaveLength(2)
    const enqueueCommands = commands.filter((command) => command.kind === 'task.enqueue')
    expect(enqueueCommands).toHaveLength(2)
    expect(enqueueCommands.every((command) => command.availableAt <= new Date())).toBe(true)
  })
  it('rolls back the entire batch and leaves the Grant unconsumed when any freeze fails', async () => {
    const seeded = await seedExecution(1)
    await expect(
      prisma.$transaction(
        async (transaction) =>
          await submitApprovedOperationPlanTasks({
            approvalGrantId: seeded.issued.approvalGrantId,
            operationExecutionId: seeded.execution.id,
            transaction,
            operationSource: 'assistant-panel',
          }),
      ),
    ).rejects.toMatchObject({ name: 'InsufficientBalanceError' })
    const [grant, execution, taskCount, freezeCount, commandCount] = await Promise.all([
      prisma.approvalGrant.findUnique({
        where: { id: seeded.issued.approvalGrantId },
      }),
      prisma.operationExecution.findUnique({
        where: { id: seeded.execution.id },
      }),
      prisma.task.count({
        where: { operationExecutionId: seeded.execution.id },
      }),
      prisma.balanceFreeze.count(),
      prisma.outboxCommand.count(),
    ])
    expect(grant).toMatchObject({
      version: 0,
      consumedAt: null,
      consumedExecutionId: null,
    })
    expect(execution?.status).toBe('committing')
    expect(taskCount).toBe(0)
    expect(freezeCount).toBe(0)
    expect(commandCount).toBe(0)
  })
  it('releases every durable enqueue command only after the operation execution commits', async () => {
    const seeded = await seedExecution(10)
    await prisma.operationExecution.delete({
      where: { id: seeded.execution.id },
    })
    const operation = createApprovedBatchOperation(seeded.plan)
    const beforeInvoke = new Date()
    const output = await invokeApprovedOperationPlan({
      operation,
      ctx: {
        request: new Request('http://localhost') as never,
        userId: seeded.user.id,
        projectId: seeded.project.id,
        context: {},
        source: 'assistant-panel',
        writer: null,
      },
      normalizedInput: { episodeId: null },
      invocation: {
        approvalGrantId: seeded.issued.approvalGrantId,
        requestId: seeded.issued.operationRequestId,
      },
    })
    const [execution, enqueueCommands] = await Promise.all([
      prisma.operationExecution.findUnique({
        where: { approvalGrantId: seeded.issued.approvalGrantId },
      }),
      prisma.outboxCommand.findMany({
        where: { kind: 'task.enqueue', aggregateType: 'task' },
        orderBy: { createdAt: 'asc' },
      }),
    ])
    expect(output.taskIds).toHaveLength(2)
    expect(execution).toMatchObject({ status: 'completed' })
    expect(enqueueCommands).toHaveLength(2)
    expect(enqueueCommands.every((command) => command.availableAt >= beforeInvoke && command.availableAt <= new Date())).toBe(true)
    for (const taskId of output.taskIds) {
      queuedTaskIds.push(taskId)
      await enqueuePersistedApprovedTask({
        taskId,
        operationExecutionId: execution!.id,
      })
      await expect(observeTaskJob(taskId)).resolves.toBe('alive')
    }
    const enqueuedTasks = await prisma.task.findMany({
      where: { id: { in: output.taskIds } },
      orderBy: { operationPlanTaskId: 'asc' },
    })
    expect(enqueuedTasks.every((task) => task.enqueuedAt instanceof Date)).toBe(true)
  })
  it('rolls back Grant, execution, Task, freeze, and Outbox when killed after batch submission', async () => {
    const seeded = await seedExecution(10)
    await prisma.operationExecution.delete({
      where: { id: seeded.execution.id },
    })
    const operation = createApprovedBatchOperation(seeded.plan, async () => {
      throw new Error('FAULT_AFTER_APPROVED_BATCH_SUBMISSION')
    })
    await expect(
      invokeApprovedOperationPlan({
        operation,
        ctx: {
          request: new Request('http://localhost') as never,
          userId: seeded.user.id,
          projectId: seeded.project.id,
          context: {},
          source: 'assistant-panel',
          writer: null,
        },
        normalizedInput: { episodeId: null },
        invocation: {
          approvalGrantId: seeded.issued.approvalGrantId,
          requestId: seeded.issued.operationRequestId,
        },
      }),
    ).rejects.toThrow('FAULT_AFTER_APPROVED_BATCH_SUBMISSION')
    const [grant, executions, tasks, freezes, commands] = await Promise.all([
      prisma.approvalGrant.findUnique({
        where: { id: seeded.issued.approvalGrantId },
      }),
      prisma.operationExecution.count({
        where: { approvalGrantId: seeded.issued.approvalGrantId },
      }),
      prisma.task.count({
        where: { approvalGrantId: seeded.issued.approvalGrantId },
      }),
      prisma.balanceFreeze.count(),
      prisma.outboxCommand.count(),
    ])
    expect(grant).toMatchObject({
      version: 0,
      consumedAt: null,
      consumedExecutionId: null,
    })
    expect({ executions, tasks, freezes, commands }).toEqual({
      executions: 0,
      tasks: 0,
      freezes: 0,
      commands: 0,
    })
  })
  it('serializes concurrent duplicate invocations and returns one completed execution output', async () => {
    const seeded = await seedExecution(10)
    await prisma.operationExecution.delete({
      where: { id: seeded.execution.id },
    })
    const operation = createApprovedBatchOperation(seeded.plan)
    const invocation = {
      operation,
      ctx: {
        request: new Request('http://localhost') as never,
        userId: seeded.user.id,
        projectId: seeded.project.id,
        context: {},
        source: 'assistant-panel',
        writer: null,
      },
      normalizedInput: { episodeId: null },
      invocation: {
        approvalGrantId: seeded.issued.approvalGrantId,
        requestId: seeded.issued.operationRequestId,
      },
    }
    const [first, second] = await Promise.all([invokeApprovedOperationPlan(invocation), invokeApprovedOperationPlan(invocation)])
    expect(second).toEqual(first)
    await expect(
      prisma.operationExecution.count({
        where: { approvalGrantId: seeded.issued.approvalGrantId },
      }),
    ).resolves.toBe(1)
    await expect(
      prisma.task.count({
        where: { approvalGrantId: seeded.issued.approvalGrantId },
      }),
    ).resolves.toBe(2)
  })
})
