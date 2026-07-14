import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser, seedBalance } from '../../helpers/billing-fixtures'
import { persistOperationPlanSnapshot } from '@/lib/operations/operation-plan-snapshot'
import {
  invokeApprovedOperationPlan,
  issueApprovalGrant,
  issueApprovalGrantGroup,
} from '@/lib/operations/planned-operation-invocation'
import { submitApprovedOperationPlanTasks } from '@/lib/task/approved-plan-submitter'
import { TASK_TYPE, type TaskBillingInfo } from '@/lib/task/types'
import { quoteOperationPlan, type OperationPlan } from '@/lib/operations/planning'
import { makeTestOperation, EFFECTS_BILLABLE } from '../../helpers/project-agent-operations'
import { z } from 'zod'
import { enqueuePersistedTask } from '@/lib/task/enqueue'
import { observeTaskJob } from '@/lib/task/reconcile'
import { removeTaskJob } from '@/lib/task/queues'
import { createProjectAgentUserTurnRun } from '@/lib/project-agent/runs'
import { appendProjectAgentEvents } from '@/lib/project-agent/event'
import { createProjectAgentRunFence } from '@/lib/project-agent/run-fence'
import { bindProjectAgentWaitToTasksInTransaction } from '@/lib/project-agent/waits'
import type { ProjectAgentOperationTaskBatchBinding } from '@/lib/operations/types'
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
  const episode = await prisma.projectEpisode.create({
    data: { projectId: project.id, episodeNumber: 1, name: 'Approved preview episode' },
  })
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
      episodeId: episode.id,
      dedupeKey: `style-preview:${id}`,
      priority: 0,
    })),
  }
  const quote = await quoteOperationPlan(plan)
  const snapshot = await persistOperationPlanSnapshot({
    plan,
    normalizedInput: { episodeId: episode.id },
    quote,
    episodeId: episode.id,
  })
  const issued = await issueApprovalGrant({
    userId: user.id,
    planSnapshotId: snapshot.id,
    requestId: 'approved-request-1',
  })
  const execution = await prisma.operationExecution.create({
    data: {
      id: 'approved-execution-1',
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
  return { user, project, episode, plan, snapshot, issued, execution }
}
function createApprovedBatchOperation(plan: OperationPlan, afterSubmit?: () => Promise<void>) {
  return makeTestOperation({
    id: plan.operationId,
    summary: 'approved batch integration',
    intent: 'act',
    effects: EFFECTS_BILLABLE,
    confirmation: { kind: 'billable_media', required: true },
    inputSchema: z.object({ episodeId: z.string().min(1) }),
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
  it('creates every Task, freeze, and durable enqueue responsibility from an already-consumed Grant', async () => {
    const seeded = await seedExecution(10)
    await prisma.approvalGrant.update({
      where: { id: seeded.issued.approvalGrantId },
      data: {
        consumedAt: new Date(),
        consumedExecutionId: seeded.execution.id,
        version: 1,
      },
    })
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
  it('returns an empty Task batch for an authorized zero-Task noop plan', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const plan: OperationPlan = {
      kind: 'task_submission',
      operationId: 'generate_edit_script_assets',
      projectId: project.id,
      userId: user.id,
      tasks: [],
    }
    const quote = await quoteOperationPlan(plan)
    const snapshot = await persistOperationPlanSnapshot({
      plan,
      normalizedInput: { episodeId: null },
      quote,
    })
    const issued = await issueApprovalGrant({
      userId: user.id,
      planSnapshotId: snapshot.id,
      requestId: 'approved-zero-task-request',
    })
    const execution = await prisma.operationExecution.create({
      data: {
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
    await prisma.approvalGrant.update({
      where: { id: issued.approvalGrantId },
      data: { consumedAt: new Date(), consumedExecutionId: execution.id, version: 1 },
    })

    const results = await prisma.$transaction(async (transaction) =>
      await submitApprovedOperationPlanTasks({
        approvalGrantId: issued.approvalGrantId,
        operationExecutionId: execution.id,
        transaction,
        operationSource: 'assistant-panel',
      }),
    )

    expect([...results]).toEqual([])
    await expect(prisma.task.count({ where: { operationExecutionId: execution.id } })).resolves.toBe(0)
  })
  /**
   * Authority: BA-20 grouped approval grant atomicity.
   * Rejects: issuing an earlier member Grant when a later member snapshot belongs to another user.
   * Production entry: issueApprovalGrantGroup with real MySQL row locks and transaction rollback.
   * Oracle: the request rejects and neither snapshot has a persisted Grant.
   * Command: BILLING_TEST_BOOTSTRAP=1 npx vitest run tests/integration/task/approved-operation-plan-batch.integration.test.ts
   */
  it('rolls back every member Grant when one grouped approval snapshot is unauthorized', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const otherUser = await createTestUser()
    const otherProject = await createTestProject(otherUser.id)
    const persistEmptyPlan = async (input: {
      operationId: string
      projectId: string
      userId: string
    }) => {
      const plan: OperationPlan = {
        kind: 'task_submission',
        operationId: input.operationId,
        projectId: input.projectId,
        userId: input.userId,
        tasks: [],
      }
      return await persistOperationPlanSnapshot({
        plan,
        normalizedInput: { episodeId: null },
        quote: await quoteOperationPlan(plan),
      })
    }
    const owned = await persistEmptyPlan({
      operationId: 'generate_episode_bgm_score',
      projectId: project.id,
      userId: user.id,
    })
    const unauthorized = await persistEmptyPlan({
      operationId: 'generate_episode_ambient_sound',
      projectId: otherProject.id,
      userId: otherUser.id,
    })

    await expect(issueApprovalGrantGroup({
      userId: user.id,
      requests: [
        { planSnapshotId: owned.id, requestId: 'audio-group-approval' },
        { planSnapshotId: unauthorized.id, requestId: 'audio-group-approval' },
      ],
    })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(prisma.approvalGrant.count({
      where: { planSnapshotId: { in: [owned.id, unauthorized.id] } },
    })).resolves.toBe(0)
  })
  it('rolls back the Task batch without mutating the already-consumed Grant when any freeze fails', async () => {
    const seeded = await seedExecution(1)
    await prisma.approvalGrant.update({
      where: { id: seeded.issued.approvalGrantId },
      data: {
        consumedAt: new Date(),
        consumedExecutionId: seeded.execution.id,
        version: 1,
      },
    })
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
      version: 1,
      consumedExecutionId: seeded.execution.id,
    })
    expect(grant?.consumedAt).toBeInstanceOf(Date)
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
      normalizedInput: { episodeId: seeded.episode.id },
      invocation: {
        approvalGrantId: seeded.issued.approvalGrantId,
        requestId: seeded.issued.operationRequestId,
      },
    })
    const [grant, execution, enqueueCommands] = await Promise.all([
      prisma.approvalGrant.findUnique({
        where: { id: seeded.issued.approvalGrantId },
      }),
      prisma.operationExecution.findUnique({
        where: { approvalGrantId: seeded.issued.approvalGrantId },
      }),
      prisma.outboxCommand.findMany({
        where: { kind: 'task.enqueue', aggregateType: 'task' },
        orderBy: { createdAt: 'asc' },
      }),
    ])
    expect(output.taskIds).toHaveLength(2)
    expect(grant).toMatchObject({
      version: 1,
      consumedExecutionId: execution?.id,
    })
    expect(grant?.consumedAt).toBeInstanceOf(Date)
    expect(execution).toMatchObject({ status: 'completed' })
    expect(enqueueCommands).toHaveLength(2)
    expect(enqueueCommands.every((command) => command.availableAt >= beforeInvoke && command.availableAt <= new Date())).toBe(true)
    for (const taskId of output.taskIds) {
      queuedTaskIds.push(taskId)
      await enqueuePersistedTask({
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

  it('rejects direct approved-plan submission before the invoke authority consumes the Grant', async () => {
    const seeded = await seedExecution(10)

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
    ).rejects.toThrow(`APPROVAL_GRANT_NOT_USABLE:${seeded.issued.approvalGrantId}`)

    const [grant, tasks, freezes, commands] = await Promise.all([
      prisma.approvalGrant.findUnique({ where: { id: seeded.issued.approvalGrantId } }),
      prisma.task.count({ where: { operationExecutionId: seeded.execution.id } }),
      prisma.balanceFreeze.count(),
      prisma.outboxCommand.count(),
    ])
    expect(grant).toMatchObject({ version: 0, consumedAt: null, consumedExecutionId: null })
    expect({ tasks, freezes, commands }).toEqual({ tasks: 0, freezes: 0, commands: 0 })
  })

  it('rejects an existing approved batch when its durable enqueue bundle is incomplete', async () => {
    const seeded = await seedExecution(10)
    await prisma.approvalGrant.update({
      where: { id: seeded.issued.approvalGrantId },
      data: { consumedAt: new Date(), consumedExecutionId: seeded.execution.id, version: 1 },
    })
    const submit = async (transaction: Parameters<typeof submitApprovedOperationPlanTasks>[0]['transaction']) =>
      await submitApprovedOperationPlanTasks({
        approvalGrantId: seeded.issued.approvalGrantId,
        operationExecutionId: seeded.execution.id,
        transaction,
        operationSource: 'assistant-panel',
      })
    await expect(prisma.$transaction(async (transaction) => {
      const created = await submit(transaction)
      const taskId = [...created.values()][0]?.taskId
      if (!taskId) throw new Error('EXPECTED_APPROVED_TASK')
      await transaction.outboxCommand.delete({ where: { idempotencyKey: `task-enqueue:${taskId}` } })
      await submit(transaction)
    })).rejects.toThrow('TASK_BATCH_OUTBOX_BUNDLE_MISSING')
  })
})
