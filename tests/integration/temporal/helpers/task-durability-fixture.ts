import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { addBalance } from '@/lib/billing'
import { freezeBalance } from '@/lib/billing/ledger'
import { createAgentFollowUpBatchBinding } from '@/lib/agent-turn/follow-up-batch'
import { createFailureRecord } from '@/lib/errors/failure'
import type { WorkspaceResourceInputRef } from '@/lib/workspace-resource/contracts'
import { buildWorkspaceResourceId } from '@/lib/workspace-resource/identity'
import {
  materializeWorkspaceResourceInTransaction,
  reserveWorkspaceResourceInTransaction,
} from '@/lib/workspace-resource/persistence'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import { buildWorkspaceResourceLifecycleProjection } from '@/lib/workspace-resource/task-runtime-envelope'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { submitOperationTaskBatch } from '@/lib/operations/submit-operation-task'
import { buildTaskWorkflowId } from '@/lib/temporal/identity'
import {
  TASK_TYPE,
  type TaskBillingInfo,
} from '@/lib/task/types'
import { prisma } from '../../../helpers/prisma'

export interface TaskDurabilityFixture {
  readonly userId: string
  readonly projectId: string
  readonly threadId: string
  readonly originTurnId: string
  readonly batchId: string
  readonly firstTaskId: string
  readonly secondTaskId: string
  readonly mediaObjectIds: readonly string[]
}

export interface TaskWorkerKillFixture {
  readonly userId: string
  readonly projectId: string
  readonly taskId: string
  readonly checkpointId: string
  readonly mediaObjectIds: readonly string[]
}

export interface TaskLateCancelFixture {
  readonly userId: string
  readonly projectId: string
  readonly taskId: string
  readonly checkpointId: string
  readonly freezeId: string
  readonly mediaObjectId: string
  readonly mediaObjectIds: readonly string[]
  readonly resourceId: string
}

const operationId = 'merge_videos'

async function seedSourceVideos(input: {
  readonly suffix: string
  readonly userId: string
  readonly projectId: string
}): Promise<{
  readonly references: readonly WorkspaceResourceInputRef[]
  readonly mediaObjectIds: readonly string[]
}> {
  const media = await Promise.all([0, 1].map(async (index) => (
    await ensureMediaObjectFromStorageKey(
      `tests/temporal/task-durability/${input.suffix}-source-${String(index)}.mp4`,
      {
        mimeType: 'video/mp4',
        sizeBytes: 1,
        width: 1,
        height: 1,
        durationMs: 1_000,
      },
    )
  )))
  const references = await prisma.$transaction(async (tx) => {
    const created: WorkspaceResourceInputRef[] = []
    for (const [index, mediaObject] of media.entries()) {
      const resourceId = buildWorkspaceResourceId({
        operationId: 'task_durability_source',
        requestId: input.suffix,
        memberIndex: index,
      })
      const workspacePath = `task-durability-${input.suffix}-source-${String(index)}`
      await reserveWorkspaceResourceInTransaction(tx, {
        resourceId,
        userId: input.userId,
        projectId: input.projectId,
        outputPath: workspacePath,
        mediaType: 'video',
        schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO,
        sourceType: 'temporal_test_fixture',
        sourceId: `${input.suffix}:source:${String(index)}`,
      })
      await materializeWorkspaceResourceInTransaction(tx, {
        resourceId,
        userId: input.userId,
        projectId: input.projectId,
        mediaType: 'video',
        schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO,
        content: { kind: 'media', mediaId: mediaObject.id },
        inputs: [],
        provenance: {
          operationId: null,
          inputHash: null,
          taskId: null,
          operationExecutionId: null,
          toolCallId: null,
          prompt: null,
          modelKey: null,
          generationOptions: null,
        },
      })
      created.push({
        resourceId,
        contentVersion: 1,
        workspacePath,
        role: 'source_video',
        position: index,
      })
    }
    return created
  })
  return { references, mediaObjectIds: media.map((item) => item.id) }
}

async function submitFixtureTask(input: {
  readonly suffix: string
  readonly userId: string
  readonly projectId: string
  readonly followUpBatchBinding:
    | ReturnType<typeof createAgentFollowUpBatchBinding>
    | null
  readonly references: readonly WorkspaceResourceInputRef[]
}): Promise<string> {
  const requestId = `task-durability-request-${input.suffix}`
  const resourceId = buildWorkspaceResourceId({
    operationId,
    requestId,
    memberIndex: 0,
  })
  const results = await prisma.$transaction(
    async (transaction) =>
      await submitOperationTaskBatch([
        {
          request: null,
          requestId,
          userId: input.userId,
          projectId: input.projectId,
          type: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE,
          targetType: 'WorkspaceResource',
          targetId: resourceId,
          operationId,
          source: 'system',
          operationExecutionTransaction: transaction,
          followUpBatchBinding: input.followUpBatchBinding,
          payload: {
            lifecycleProjection: buildWorkspaceResourceLifecycleProjection([
              {
                resourceId,
                mediaType: 'video',
                schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO,
                name: `Task durability ${input.suffix}`,
              },
            ]),
            resource: {
              resourceId,
              mediaType: 'video',
              schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO,
              prompt: null,
              modelKey: null,
              inputHash: 'b'.repeat(64),
              inputs: input.references,
              generationOptions: { mergeMode: 'ordered_concat' },
              musicCues: [],
              toolCallId: null,
            },
          },
          dedupeKey: `task-durability-${input.suffix}`,
          locale: 'en',
          decoratePayload: false,
          onTaskCreatedInTransaction: async (transaction, task) => {
            await reserveWorkspaceResourceInTransaction(transaction, {
              resourceId,
              userId: input.userId,
              projectId: input.projectId,
              outputPath: `task-durability-${input.suffix}-output`,
              mediaType: 'video',
              schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO,
              operationId,
              inputHash: 'b'.repeat(64),
              taskId: task.id,
              generationOptions: { mergeMode: 'ordered_concat' },
            })
          },
        },
      ]),
    {
      maxWait: 10_000,
      timeout: 30_000,
    },
  )
  const task = results[0]
  if (!task || results.length !== 1) {
    throw new Error('TASK_DURABILITY_SUBMISSION_RESULT_INVALID')
  }
  return task.taskId
}

async function seedFinalFailureCheckpoint(
  taskId: string,
): Promise<{ id: string }> {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { executionFingerprint: true },
  })
  if (!task.executionFingerprint) {
    throw new Error(`TASK_DURABILITY_FINGERPRINT_MISSING:${taskId}`)
  }
  const workflowId = buildTaskWorkflowId(taskId)
  return await prisma.taskExecutionCheckpoint.create({
    data: {
      id: `task-durability-checkpoint-${randomUUID()}`,
      taskId,
      stepKey: '__temporal_attempt_failure__:1',
      inputFingerprint: task.executionFingerprint,
      state: 'ready',
      output: {
        version: 1,
        workflowId,
        attemptId: `${workflowId}:attempt:1`,
        attempt: 1,
        failure: {
          failure: createFailureRecord(
            'PROVIDER_SUBMISSION_REJECTED',
            'Deterministic terminal fixture failure',
            {
              details: { reasonCode: 'TASK_DURABILITY_EXPECTED_FINAL' },
              context: {
              system: 'provider',
              provider: 'temporal-test-provider',
              phase: 'submit',
              },
            },
          ) as unknown as Prisma.InputJsonObject,
          retryDisposition: 'final',
        },
      } satisfies Prisma.InputJsonValue,
      completedAt: new Date(),
    },
    select: { id: true },
  })
}

async function seedSuccessfulHandlerCheckpoint(input: {
  readonly taskId: string
  readonly mediaObjectId: string
}): Promise<{ id: string }> {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: input.taskId },
    select: { executionFingerprint: true },
  })
  if (!task.executionFingerprint) {
    throw new Error(
      `TASK_DURABILITY_FINGERPRINT_MISSING:${input.taskId}`,
    )
  }
  return await prisma.taskExecutionCheckpoint.create({
    data: {
      id: `task-late-cancel-checkpoint-${randomUUID()}`,
      taskId: input.taskId,
      stepKey: '__handler_result__',
      inputFingerprint: task.executionFingerprint,
      state: 'ready',
      output: {
        result: {
          mediaId: input.mediaObjectId,
        },
        textUsage: [],
      } satisfies Prisma.InputJsonValue,
      completedAt: new Date(),
    },
    select: { id: true },
  })
}

export async function createTaskDurabilityFixture(): Promise<TaskDurabilityFixture> {
  const suffix = randomUUID()
  const userId = `task-durability-user-${suffix}`
  const projectId = `task-durability-project-${suffix}`
  const threadId = `task-durability-thread-${suffix}`
  const originTurnId = `task-durability-origin-${suffix}`
  const executionKey = `task-durability-execution-${suffix}`

  await prisma.user.create({
    data: {
      id: userId,
      name: 'Task durability test',
      email: `task-durability-${suffix}@example.com`,
      preferences: {
        create: {
          imageConcurrency: 1,
          videoConcurrency: 1,
        },
      },
      projects: {
        create: {
          id: projectId,
          name: 'Task durability project',
        },
      },
    },
  })
  await prisma.projectAssistantThread.create({
    data: {
      id: threadId,
      projectId,
      userId,
      assistantId: 'workspace-command',
      messagesJson: [],
    },
  })
  await prisma.projectAgentTurn.create({
    data: {
      id: originTurnId,
      threadId,
      projectId,
      userId,
      sourceKind: 'user',
      sourceId: `task-durability-source-${suffix}`,
      payloadHash: 'a'.repeat(64),
      requestId: `task-durability-origin-${suffix}`,
      status: 'waiting_approval',
      attempt: 1,
      contextJson: {
        locale: 'en',
        selectedScopeRef: null,
        selectedAssetId: null,
      },
      startedAt: new Date(),
    },
  })

  const followUpBatchBinding = createAgentFollowUpBatchBinding({
    executionKey,
    turnId: originTurnId,
    callId: `task-durability-call-${suffix}`,
    operationId,
  })
  const sourceVideos = await seedSourceVideos({ suffix, userId, projectId })
  const firstTaskId = await submitFixtureTask({
    suffix: `${suffix}-first`,
    userId,
    projectId,
    followUpBatchBinding,
    references: sourceVideos.references,
  })
  const batch = await prisma.followUpBatch.findUniqueOrThrow({
    where: { executionKey },
    select: { id: true },
  })
  const secondTaskId = await submitFixtureTask({
    suffix: `${suffix}-second`,
    userId,
    projectId,
    followUpBatchBinding: null,
    references: sourceVideos.references,
  })
  await Promise.all([
    seedFinalFailureCheckpoint(firstTaskId),
    seedFinalFailureCheckpoint(secondTaskId),
  ])
  await prisma.projectAgentTurn.update({
    where: { id: originTurnId },
    data: {
      status: 'completed',
      finishedAt: new Date(),
    },
  })
  return {
    userId,
    projectId,
    threadId,
    originTurnId,
    batchId: batch.id,
    firstTaskId,
    secondTaskId,
    mediaObjectIds: sourceVideos.mediaObjectIds,
  }
}

export async function createTaskWorkerKillFixture(): Promise<TaskWorkerKillFixture> {
  const suffix = randomUUID()
  const userId = `task-worker-kill-user-${suffix}`
  const projectId = `task-worker-kill-project-${suffix}`
  await prisma.user.create({
    data: {
      id: userId,
      name: 'Task worker kill test',
      email: `task-worker-kill-${suffix}@example.com`,
      preferences: {
        create: {
          imageConcurrency: 1,
          videoConcurrency: 1,
        },
      },
      projects: {
        create: {
          id: projectId,
          name: 'Task worker kill project',
        },
      },
    },
  })
  const sourceVideos = await seedSourceVideos({ suffix, userId, projectId })
  const taskId = await submitFixtureTask({
    suffix: `${suffix}-worker-kill`,
    userId,
    projectId,
    followUpBatchBinding: null,
    references: sourceVideos.references,
  })
  const checkpoint = await seedFinalFailureCheckpoint(taskId)
  return {
    userId,
    projectId,
    taskId,
    checkpointId: checkpoint.id,
    mediaObjectIds: sourceVideos.mediaObjectIds,
  }
}

export async function createTaskLateCancelFixture(): Promise<TaskLateCancelFixture> {
  const suffix = randomUUID()
  const userId = `task-late-cancel-user-${suffix}`
  const projectId = `task-late-cancel-project-${suffix}`
  await prisma.user.create({
    data: {
      id: userId,
      name: 'Task late cancel test',
      email: `task-late-cancel-${suffix}@example.com`,
      preferences: {
        create: {
          imageConcurrency: 1,
          videoConcurrency: 1,
        },
      },
      projects: {
        create: {
          id: projectId,
          name: 'Task late cancel project',
        },
      },
    },
  })
  const sourceVideos = await seedSourceVideos({ suffix, userId, projectId })
  const taskId = await submitFixtureTask({
    suffix: `${suffix}-late-cancel`,
    userId,
    projectId,
    followUpBatchBinding: null,
    references: sourceVideos.references,
  })
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { targetId: true },
  })

  const balanceAdded = await addBalance(userId, 10, {
    reason: 'Task late cancel durability fixture',
    idempotencyKey: `task-late-cancel-balance-${suffix}`,
  })
  if (!balanceAdded) {
    throw new Error('TASK_LATE_CANCEL_BALANCE_SETUP_FAILED')
  }
  const freeze = await freezeBalance(userId, 1, {
    source: 'task',
    taskId,
    idempotencyKey: `task-late-cancel-freeze-${suffix}`,
    metadata: {
      projectId,
      taskType: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE,
      action: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE,
      apiType: 'video',
      model: 'task-late-cancel-model',
      quantity: 1,
      unit: 'video',
    },
  })
  if (freeze.status !== 'frozen') {
    throw new Error(`TASK_LATE_CANCEL_FREEZE_SETUP_FAILED:${freeze.status}`)
  }
  const billingInfo = {
    billable: true,
    source: 'task',
    taskType: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE,
    apiType: 'video',
    model: 'task-late-cancel-model',
    quantity: 1,
    unit: 'video',
    maxFrozenCost: 1,
    pricingVersion: 'task-late-cancel-v1',
    action: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE,
    billingKey: taskId,
    freezeId: freeze.freezeId,
    modeSnapshot: 'ENFORCE',
    status: 'frozen',
  } satisfies TaskBillingInfo
  await prisma.task.update({
    where: { id: taskId },
    data: {
      billingInfo: billingInfo as Prisma.InputJsonValue,
    },
  })

  const media = await ensureMediaObjectFromStorageKey(
    `tests/temporal/task-late-cancel/${suffix}.mp4`,
    {
      mimeType: 'video/mp4',
      sizeBytes: 1,
      width: 1,
      height: 1,
      durationMs: 1_000,
    },
  )
  const checkpoint = await seedSuccessfulHandlerCheckpoint({
    taskId,
    mediaObjectId: media.id,
  })
  return {
    userId,
    projectId,
    taskId,
    checkpointId: checkpoint.id,
    freezeId: freeze.freezeId,
    mediaObjectId: media.id,
    mediaObjectIds: [...sourceVideos.mediaObjectIds, media.id],
    resourceId: task.targetId,
  }
}

export async function removeTaskLateCancelFixture(
  fixture: TaskLateCancelFixture,
): Promise<void> {
  await prisma.workspaceResourceLineage.deleteMany({
    where: { outputResourceId: fixture.resourceId },
  })
  await prisma.workspaceResource.deleteMany({
    where: { projectId: fixture.projectId },
  })
  await prisma.task.deleteMany({
    where: { id: fixture.taskId },
  })
  await prisma.mediaObject.deleteMany({ where: { id: { in: [...fixture.mediaObjectIds] } } })
  await prisma.balanceTransaction.deleteMany({
    where: { userId: fixture.userId },
  })
  await prisma.balanceFreeze.deleteMany({
    where: { id: fixture.freezeId },
  })
  await prisma.project.deleteMany({
    where: { id: fixture.projectId },
  })
  await prisma.user.deleteMany({
    where: { id: fixture.userId },
  })
}

export async function removeTaskWorkerKillFixture(
  fixture: TaskWorkerKillFixture,
): Promise<void> {
  await prisma.workspaceResource.deleteMany({
    where: { projectId: fixture.projectId },
  })
  await prisma.task.deleteMany({
    where: { id: fixture.taskId },
  })
  await prisma.project.deleteMany({
    where: { id: fixture.projectId },
  })
  await prisma.user.deleteMany({
    where: { id: fixture.userId },
  })
  await prisma.mediaObject.deleteMany({ where: { id: { in: [...fixture.mediaObjectIds] } } })
}

export async function removeTaskDurabilityFixture(
  fixture: TaskDurabilityFixture,
): Promise<void> {
  await prisma.followUpBatch.deleteMany({
    where: { id: fixture.batchId },
  })
  await prisma.projectAssistantThread.deleteMany({
    where: { id: fixture.threadId },
  })
  await prisma.workspaceResource.deleteMany({
    where: { projectId: fixture.projectId },
  })
  await prisma.task.deleteMany({
    where: {
      id: {
        in: [fixture.firstTaskId, fixture.secondTaskId],
      },
    },
  })
  await prisma.project.deleteMany({
    where: { id: fixture.projectId },
  })
  await prisma.user.deleteMany({
    where: { id: fixture.userId },
  })
  await prisma.mediaObject.deleteMany({ where: { id: { in: [...fixture.mediaObjectIds] } } })
}
