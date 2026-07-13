import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser, seedBalance } from '../../helpers/billing-fixtures'
import { persistOperationPlanSnapshot } from '@/lib/operations/operation-plan-snapshot'
import { invokeApprovedOperationPlan, issueApprovalGrant } from '@/lib/operations/planned-operation-invocation'
import { submitApprovedOperationPlanTasks } from '@/lib/task/approved-plan-submitter'
import { TASK_TYPE, type TaskBillingInfo } from '@/lib/task/types'
import { quoteOperationPlan, type OperationPlan } from '@/lib/operations/planning'
import { makeTestOperation, EFFECTS_BILLABLE } from '../../helpers/project-agent-operations'
import { z } from 'zod'
import { createProjectAgentUserTurnRun } from '@/lib/project-agent/runs'
import { appendProjectAgentEvents } from '@/lib/project-agent/event'
import { createProjectAgentRunFence } from '@/lib/project-agent/run-fence'
import {
  bindProjectAgentCollectingWaitMemberInTransaction,
  bindProjectAgentWaitToTasksInTransaction,
  prepareProjectAgentCollectingTaskWait,
  sealProjectAgentCollectingTaskWait,
} from '@/lib/project-agent/waits'
import type { ProjectAgentOperationTaskBatchBinding } from '@/lib/operations/types'
import type { ProjectAgentTaskSuspensionReceipt } from '@/lib/project-agent/suspension'
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
  beforeEach(async () => {
    await resetBillingState()
    await prisma.outboxCommand.deleteMany()
    await prisma.operationExecution.deleteMany()
    await prisma.approvalGrant.deleteMany()
    await prisma.operationPlanSnapshot.deleteMany()
    process.env.BILLING_MODE = 'ENFORCE'
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
        normalizedInput: { episodeId: seeded.episode.id },
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
  it('rolls back the invoke-owned Grant consumption with the whole batch when a freeze fails', async () => {
    const seeded = await seedExecution(1)
    await prisma.operationExecution.delete({
      where: { id: seeded.execution.id },
    })
    const operation = createApprovedBatchOperation(seeded.plan)
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
        normalizedInput: { episodeId: seeded.episode.id },
        invocation: {
          approvalGrantId: seeded.issued.approvalGrantId,
          requestId: seeded.issued.operationRequestId,
        },
      }),
    ).rejects.toMatchObject({ name: 'InsufficientBalanceError' })
    const [grant, executions, tasks, freezes, commands] = await Promise.all([
      prisma.approvalGrant.findUnique({ where: { id: seeded.issued.approvalGrantId } }),
      prisma.operationExecution.count({ where: { approvalGrantId: seeded.issued.approvalGrantId } }),
      prisma.task.count({ where: { approvalGrantId: seeded.issued.approvalGrantId } }),
      prisma.balanceFreeze.count(),
      prisma.outboxCommand.count(),
    ])
    expect(grant).toMatchObject({ version: 0, consumedAt: null, consumedExecutionId: null })
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
      normalizedInput: { episodeId: seeded.episode.id },
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
  it('commits an approved Task batch and its single Assistant Wait in the same transaction', async () => {
    const seeded = await seedExecution(10)
    await prisma.operationExecution.delete({ where: { id: seeded.execution.id } })
    const { run: initialRun } = await createProjectAgentUserTurnRun({
      runId: 'approved-assistant-run-1',
      requestId: 'approved-assistant-request-1',
      projectId: seeded.project.id,
      userId: seeded.user.id,
      assistantId: 'workspace-command',
      message: {
        id: 'approved-assistant-message-1',
        role: 'user',
        parts: [{ type: 'text', text: 'generate previews' }],
      },
    })
    const operationActivityId = 'approved-assistant-operation-activity-1'
    const runFence = createProjectAgentRunFence(initialRun)
    await appendProjectAgentEvents({
      scope: {
        projectId: seeded.project.id,
        userId: seeded.user.id,
        assistantId: 'workspace-command',
      },
      events: [{
        runFence,
        idempotencyKey: `activity-started:${operationActivityId}`,
        event: {
          kind: 'activity.started',
          runId: initialRun.id,
          activityId: operationActivityId,
          type: 'operation',
          operationId: seeded.plan.operationId,
        },
      }],
    })
    let bound = false
    let committed = false
    let committedSuspension: ProjectAgentTaskSuspensionReceipt | null = null
    const taskBatchBinding: ProjectAgentOperationTaskBatchBinding = {
      async bindInTransaction(transaction, batch) {
        const suspension = await bindProjectAgentWaitToTasksInTransaction(transaction, {
          runFence,
          runId: initialRun.id,
          projectId: seeded.project.id,
          userId: seeded.user.id,
          assistantId: 'workspace-command',
          operationId: batch.operationId,
          taskIds: [...batch.taskIds],
          followUpMode: 'resume_agent',
          sourceOperationActivityId: operationActivityId,
        })
        if (!suspension) throw new Error('EXPECTED_ASSISTANT_WAIT')
        bound = true
        committedSuspension = suspension
        return suspension
      },
      isBound: () => bound,
      markCommitted: () => { committed = bound },
      isCommitted: () => committed,
      getCommittedSuspension: () => committed ? committedSuspension : null,
    }
    const output = await invokeApprovedOperationPlan({
      operation: createApprovedBatchOperation(seeded.plan),
      ctx: {
        request: new Request('http://localhost') as never,
        userId: seeded.user.id,
        projectId: seeded.project.id,
        context: {},
        source: 'assistant-panel',
        writer: null,
        executionFence: {
          runFence,
          signal: new AbortController().signal,
        },
        taskBatchBinding,
      },
      normalizedInput: { episodeId: seeded.episode.id },
      invocation: {
        approvalGrantId: seeded.issued.approvalGrantId,
        requestId: seeded.issued.operationRequestId,
      },
    })
    const [storedRun, waits, tasks] = await Promise.all([
      prisma.projectAgentRun.findUniqueOrThrow({ where: { id: initialRun.id } }),
      prisma.projectAgentWait.findMany({ where: { runId: initialRun.id } }),
      prisma.task.findMany({ where: { id: { in: output.taskIds } } }),
    ])
    expect(taskBatchBinding.isCommitted()).toBe(true)
    expect(storedRun.status).toBe('awaiting_task')
    expect(waits).toHaveLength(1)
    expect((waits[0]?.taskIds as string[]).sort()).toEqual([...output.taskIds].sort())
    expect(tasks).toHaveLength(2)
  })

  it('collects two independent Operation task batches into one sealed Assistant Wait', async () => {
    const seeded = await seedExecution(10)
    await prisma.operationExecution.delete({ where: { id: seeded.execution.id } })
    const { run: initialRun } = await createProjectAgentUserTurnRun({
      runId: 'approved-assistant-group-run-1',
      requestId: 'approved-assistant-group-request-1',
      projectId: seeded.project.id,
      userId: seeded.user.id,
      assistantId: 'workspace-command',
      message: {
        id: 'approved-assistant-group-message-1',
        role: 'user',
        parts: [{ type: 'text', text: 'generate core and assets' }],
      },
    })
    const runFence = createProjectAgentRunFence(initialRun)
    const group = await prepareProjectAgentCollectingTaskWait({
      runFence,
      runId: initialRun.id,
      executionSegmentId: 'decision:approved-assistant-group-1',
      projectId: seeded.project.id,
      userId: seeded.user.id,
      assistantId: 'workspace-command',
      operationId: seeded.plan.operationId,
      operationIds: [seeded.plan.operationId, 'plan_chapters'],
      taskIds: [],
      followUpMode: 'resume_agent',
    })
    let bound = false
    let committed = false
    let committedSuspension: ProjectAgentTaskSuspensionReceipt | null = null
    const taskBatchBinding: ProjectAgentOperationTaskBatchBinding = {
      async bindInTransaction(transaction, batch) {
        const suspension = await bindProjectAgentCollectingWaitMemberInTransaction(transaction, {
          runFence,
          runId: initialRun.id,
          executionSegmentId: 'decision:approved-assistant-group-1',
          projectId: seeded.project.id,
          userId: seeded.user.id,
          assistantId: 'workspace-command',
          operationId: batch.operationId,
          taskIds: [...batch.taskIds],
          followUpMode: 'resume_agent',
          group,
        })
        bound = true
        committedSuspension = suspension
        return suspension
      },
      isBound: () => bound,
      markCommitted: () => { committed = bound },
      isCommitted: () => committed,
      getCommittedSuspension: () => committed ? committedSuspension : null,
    }
    const output = await invokeApprovedOperationPlan({
      operation: createApprovedBatchOperation(seeded.plan),
      ctx: {
        request: new Request('http://localhost') as never,
        userId: seeded.user.id,
        projectId: seeded.project.id,
        context: {},
        source: 'assistant-panel',
        writer: null,
        executionFence: {
          runFence,
          signal: new AbortController().signal,
        },
        taskBatchBinding,
      },
      normalizedInput: { episodeId: seeded.episode.id },
      invocation: {
        approvalGrantId: seeded.issued.approvalGrantId,
        requestId: seeded.issued.operationRequestId,
      },
    })
    await prisma.$transaction(async (transaction) => {
      await bindProjectAgentCollectingWaitMemberInTransaction(transaction, {
        runFence,
        runId: initialRun.id,
        executionSegmentId: 'decision:approved-assistant-group-1',
        projectId: seeded.project.id,
        userId: seeded.user.id,
        assistantId: 'workspace-command',
        operationId: 'plan_chapters',
        taskIds: [output.taskIds[0]!],
        followUpMode: 'resume_agent',
        group,
      })
    })
    await sealProjectAgentCollectingTaskWait({
      runFence,
      runId: initialRun.id,
      executionSegmentId: 'decision:approved-assistant-group-1',
      projectId: seeded.project.id,
      userId: seeded.user.id,
      assistantId: 'workspace-command',
      operationId: group.operationId,
      taskIds: output.taskIds,
      followUpMode: 'resume_agent',
      group,
    })
    const [storedRun, waits] = await Promise.all([
      prisma.projectAgentRun.findUniqueOrThrow({ where: { id: initialRun.id } }),
      prisma.projectAgentWait.findMany({ where: { runId: initialRun.id } }),
    ])
    expect(storedRun.status).toBe('awaiting_task')
    expect(waits).toHaveLength(1)
    expect(waits[0]?.status).toBe('pending')
    expect((waits[0]?.taskIds as string[]).sort()).toEqual([...output.taskIds].sort())
  })
})
