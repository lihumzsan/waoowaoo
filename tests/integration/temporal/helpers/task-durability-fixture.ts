import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { addBalance } from '@/lib/billing'
import { freezeBalance } from '@/lib/billing/ledger'
import { createAgentFollowUpBatchBinding } from '@/lib/agent-turn/follow-up-batch'
import {
  buildCreativeResourceId,
  resolveProjectCreativeResourceScope,
} from '@/lib/creative-resource/identity'
import { reserveCreativeResourcesInTransaction } from '@/lib/creative-resource/persistence'
import { CREATIVE_RESOURCE_SCHEMA } from '@/lib/creative-resource/schema-registry'
import { buildCreativeResourceLifecycleProjection } from '@/lib/creative-resource/task-runtime-envelope'
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
}

export interface TaskWorkerKillFixture {
  readonly userId: string
  readonly projectId: string
  readonly taskId: string
  readonly checkpointId: string
}

export interface TaskLateCancelFixture {
  readonly userId: string
  readonly projectId: string
  readonly taskId: string
  readonly checkpointId: string
  readonly freezeId: string
  readonly mediaObjectId: string
  readonly resourceId: string
}

const operationId = 'import_web_reference_image'

async function submitFixtureTask(input: {
  readonly suffix: string
  readonly userId: string
  readonly projectId: string
  readonly followUpBatchBinding:
    | ReturnType<typeof createAgentFollowUpBatchBinding>
    | null
}): Promise<string> {
  const requestId = `task-durability-request-${input.suffix}`
  const resourceId = buildCreativeResourceId({
    operationId,
    requestId,
    candidateIndex: 0,
  })
  const results = await prisma.$transaction(
    async (transaction) =>
      await submitOperationTaskBatch([
        {
          request: null,
          requestId,
          userId: input.userId,
          projectId: input.projectId,
          type: TASK_TYPE.CREATIVE_RESOURCE_WEB_REFERENCE,
          targetType: 'CreativeResource',
          targetId: resourceId,
          operationId,
          source: 'system',
          operationExecutionTransaction: transaction,
          followUpBatchBinding: input.followUpBatchBinding,
          payload: {
            lifecycleProjection: buildCreativeResourceLifecycleProjection([
              {
                resourceId,
                mediaType: 'image',
                schemaId: CREATIVE_RESOURCE_SCHEMA.WEB_REFERENCE_IMAGE,
                name: `Task durability ${input.suffix}`,
              },
            ]),
            resource: {
              resourceId,
              mediaType: 'image',
              schemaId: CREATIVE_RESOURCE_SCHEMA.WEB_REFERENCE_IMAGE,
              prompt: null,
              modelKey: null,
              inputHash: 'b'.repeat(64),
              inputs: [],
              generationOptions: {
                origin: 'web_search_image',
                imageUrl: `https://example.test/${input.suffix}.png`,
                sourceWebsiteUrl: `https://example.test/${input.suffix}`,
                caption: `Task durability ${input.suffix}`,
              },
              toolCallId: null,
            },
          },
          dedupeKey: `task-durability-${input.suffix}`,
          locale: 'en',
          decoratePayload: false,
          onTaskCreatedInTransaction: async (transaction) => {
            await reserveCreativeResourcesInTransaction(transaction, {
              scope: resolveProjectCreativeResourceScope({
                userId: input.userId,
                projectId: input.projectId,
                episodeId: null,
              }),
              mediaType: 'image',
              schemaId: CREATIVE_RESOURCE_SCHEMA.WEB_REFERENCE_IMAGE,
              operationId,
              requestId,
              candidates: [
                {
                  resourceId,
                  name: `Task durability ${input.suffix}`,
                  candidateIndex: 0,
                },
              ],
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
          errorCode: 'TASK_DURABILITY_EXPECTED_FINAL',
          errorMessage: 'Deterministic terminal fixture failure',
          errorDetails: null,
          failureClass: 'PERMANENT_PROVIDER',
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
      scopeRef: 'project',
      messagesJson: [],
      modelHistoryJson: [],
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
      status: 'running',
      attempt: 1,
      executionOwnerId: `task-durability-owner-${suffix}`,
      contextJson: {
        locale: 'en',
        episodeId: null,
        selectedScopeRef: null,
        selectedAssetId: null,
      },
      modelHistoryBaseVersion: 0,
      startedAt: new Date(),
    },
  })

  const followUpBatchBinding = createAgentFollowUpBatchBinding({
    executionKey,
    turnId: originTurnId,
    callId: `task-durability-call-${suffix}`,
    operationId,
  })
  const firstTaskId = await submitFixtureTask({
    suffix: `${suffix}-first`,
    userId,
    projectId,
    followUpBatchBinding,
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
  })
  await Promise.all([
    seedFinalFailureCheckpoint(firstTaskId),
    seedFinalFailureCheckpoint(secondTaskId),
  ])
  return {
    userId,
    projectId,
    threadId,
    originTurnId,
    batchId: batch.id,
    firstTaskId,
    secondTaskId,
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
  const taskId = await submitFixtureTask({
    suffix: `${suffix}-worker-kill`,
    userId,
    projectId,
    followUpBatchBinding: null,
  })
  const checkpoint = await seedFinalFailureCheckpoint(taskId)
  return {
    userId,
    projectId,
    taskId,
    checkpointId: checkpoint.id,
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
  const taskId = await submitFixtureTask({
    suffix: `${suffix}-late-cancel`,
    userId,
    projectId,
    followUpBatchBinding: null,
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
      taskType: TASK_TYPE.CREATIVE_RESOURCE_WEB_REFERENCE,
      action: TASK_TYPE.CREATIVE_RESOURCE_WEB_REFERENCE,
      apiType: 'text',
      model: 'task-late-cancel-model',
      quantity: 1,
      unit: 'token',
    },
  })
  if (freeze.status !== 'frozen') {
    throw new Error(`TASK_LATE_CANCEL_FREEZE_SETUP_FAILED:${freeze.status}`)
  }
  const billingInfo = {
    billable: true,
    source: 'task',
    taskType: TASK_TYPE.CREATIVE_RESOURCE_WEB_REFERENCE,
    apiType: 'text',
    model: 'task-late-cancel-model',
    quantity: 1,
    unit: 'token',
    maxFrozenCost: 1,
    pricingVersion: 'task-late-cancel-v1',
    action: TASK_TYPE.CREATIVE_RESOURCE_WEB_REFERENCE,
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
    `tests/temporal/task-late-cancel/${suffix}.png`,
    {
      mimeType: 'image/png',
      sizeBytes: 1,
      width: 1,
      height: 1,
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
    resourceId: task.targetId,
  }
}

export async function removeTaskLateCancelFixture(
  fixture: TaskLateCancelFixture,
): Promise<void> {
  await prisma.creativeResource.deleteMany({
    where: { id: fixture.resourceId },
  })
  await prisma.task.deleteMany({
    where: { id: fixture.taskId },
  })
  await prisma.mediaObject.deleteMany({
    where: { id: fixture.mediaObjectId },
  })
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
  await prisma.creativeResource.deleteMany({
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
  await prisma.creativeResource.deleteMany({
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
}
