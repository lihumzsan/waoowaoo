import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { createAgentFollowUpBatchBinding } from '@/lib/agent-turn/follow-up-batch'
import { createFailureRecord } from '@/lib/errors/failure'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { persistPlannedTaskEdgesInTransaction } from '@/lib/task/dependencies/persistence'
import { prepareTaskSubmissionInput } from '@/lib/task/submitter'
import { persistSubmittedTaskBatchInTransaction } from '@/lib/task/transactional-create'
import { TASK_TYPE } from '@/lib/task/types'
import { buildTaskWorkflowId } from '@/lib/temporal/identity'
import { buildWorkspaceResourceLifecycleProjection } from '@/lib/workspace-resource/task-runtime-envelope'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import {
  materializeWorkspaceResourceInTransaction,
  reserveWorkspaceResourceInTransaction,
} from '@/lib/workspace-resource/persistence'
import { prisma } from '../../../helpers/prisma'

export type DependencyGateSourceOutcome = 'completed' | 'failed'

export interface TaskDependencyGateFixture {
  readonly userId: string
  readonly projectId: string
  readonly threadId: string
  readonly originTurnId: string
  readonly operationExecutionId: string
  readonly followUpBatchId: string
  readonly source1TaskId: string
  readonly source2TaskId: string
  readonly mixTaskId: string
  readonly references: {
    readonly source1: { taskId: string; userId: string; taskType: typeof TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE; dependsOnTaskIds: readonly [] }
    readonly source2: { taskId: string; userId: string; taskType: typeof TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE; dependsOnTaskIds: readonly [] }
    readonly mix: { taskId: string; userId: string; taskType: typeof TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE; dependsOnTaskIds: readonly [string, string] }
  }
  readonly sourceOutcomes: readonly [DependencyGateSourceOutcome, DependencyGateSourceOutcome]
  readonly mediaObjectIds: readonly string[]
  readonly resourceIds: readonly string[]
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

async function seedMedia(suffix: string): Promise<readonly string[]> {
  const media = await Promise.all(
    [0, 1, 2, 3].map((index) =>
      ensureMediaObjectFromStorageKey(
        `tests/temporal/task-dependency-gate/${suffix}-${String(index)}.mp4`,
        {
          mimeType: 'video/mp4',
          sizeBytes: 1,
          width: 1,
          height: 1,
          durationMs: 1_000,
        },
      ),
    ),
  )
  return media.map((item) => item.id)
}

function buildPayload(resourceId: string, name: string): Record<string, unknown> {
  return {
    lifecycleProjection: buildWorkspaceResourceLifecycleProjection([
      {
        resourceId,
        mediaType: 'video',
        schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO,
        name,
      },
    ]),
    resource: {
      resourceId,
      mediaType: 'video',
      schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO,
      prompt: null,
      inputHash: 'd'.repeat(64),
      inputs: [],
      generationOptions: { mergeMode: 'dependency_gate_test' },
      toolCallId: null,
    },
  }
}

async function seedCheckpoint(
  taskId: string,
  result: { readonly mediaId: string } | null,
  failure: boolean,
): Promise<void> {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { executionFingerprint: true },
  })
  if (!task.executionFingerprint) throw new Error(`TASK_DEPENDENCY_GATE_FINGERPRINT_MISSING:${taskId}`)
  const workflowId = buildTaskWorkflowId(taskId)
  await prisma.taskExecutionCheckpoint.create({
    data: {
      id: `task-dependency-gate-checkpoint-${randomUUID()}`,
      taskId,
      stepKey: failure ? '__temporal_attempt_failure__:1' : '__handler_result__',
      inputFingerprint: task.executionFingerprint,
      state: 'ready',
      output: failure
        ? json({
            version: 1,
            workflowId,
            attemptId: `${workflowId}:attempt:1`,
            attempt: 1,
            failure: {
              failure: createFailureRecord(
                'PROVIDER_SUBMISSION_REJECTED',
                'Dependency gate deterministic failure',
                { details: { reasonCode: 'TASK_DEPENDENCY_GATE_EXPECTED_FAILURE' } },
              ),
              retryDisposition: 'final',
            },
          })
        : json({ result, textUsage: [] }),
      completedAt: new Date(),
    },
  })
}

export async function seedTaskDependencyGateDependentCheckpoint(
  fixture: TaskDependencyGateFixture,
): Promise<void> {
  const mediaId = fixture.mediaObjectIds[3]
  if (!mediaId) throw new Error('TASK_DEPENDENCY_GATE_OUTPUT_MEDIA_MISSING')
  await seedCheckpoint(fixture.mixTaskId, { mediaId }, false)
}

export async function createTaskDependencyGateFixture(input: {
  readonly suffix: string
  readonly sourceOutcomes: readonly [DependencyGateSourceOutcome, DependencyGateSourceOutcome]
}): Promise<TaskDependencyGateFixture> {
  const suffix = `${input.suffix}-${randomUUID()}`
  const userId = `task-dependency-gate-user-${suffix}`
  const projectId = `task-dependency-gate-project-${suffix}`
  const threadId = `task-dependency-gate-thread-${suffix}`
  const originTurnId = `task-dependency-gate-turn-${suffix}`
  const operationExecutionId = `task-dependency-gate-execution-${suffix}`
  const operationId = 'dependency_gate_test'

  await prisma.user.create({
    data: {
      id: userId,
      name: 'Dependency gate test',
      email: `task-dependency-gate-${suffix}@example.com`,
      preferences: { create: { imageConcurrency: 1, videoConcurrency: 1 } },
      projects: { create: { id: projectId, name: 'Dependency gate project' } },
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
      sourceId: `task-dependency-gate-source-${suffix}`,
      payloadHash: 'e'.repeat(64),
      requestId: `task-dependency-gate-request-${suffix}`,
      status: 'running',
      attempt: 1,
      contextJson: { locale: 'en', selectedScopeRef: null, selectedAssetId: null },
      startedAt: new Date(),
    },
  })
  const mediaObjectIds = await seedMedia(suffix)
  const source1TaskId = `task-dependency-gate-source-1-${suffix}`
  const source2TaskId = `task-dependency-gate-source-2-${suffix}`
  const mixTaskId = `task-dependency-gate-mix-${suffix}`
  const resourceIds = [source1TaskId, source2TaskId, mixTaskId]
  const followUpBatchBinding = createAgentFollowUpBatchBinding({
    executionKey: operationExecutionId,
    turnId: originTurnId,
    callId: `task-dependency-gate-call-${suffix}`,
    operationId,
  })
  const prepared = await Promise.all(
    resourceIds.map(async (resourceId, index) => ({
      ...(await prepareTaskSubmissionInput({
        userId,
        locale: 'en',
        projectId,
        type: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE,
        targetType: 'WorkspaceResource',
        targetId: resourceId,
        payload: buildPayload(resourceId, `Dependency gate ${String(index)}`),
        operationId,
        operationSource: 'system',
        operationExecutionId,
        operationRequestId: operationExecutionId,
        requestId: operationExecutionId,
        dedupeKey: `task-dependency-gate:${resourceId}`,
      })),
      id: resourceId,
      operationPlanTaskId: `task:${String(index)}`,
    })),
  )
  const persisted = await prisma.$transaction(
    async (tx) => {
      const execution = await tx.operationExecution.create({
        data: {
          id: operationExecutionId,
          executionKind: 'planned',
          userId,
          scopeKind: 'project',
          scopeId: projectId,
          projectId,
          operationId,
          requestId: operationExecutionId,
          status: 'committing',
        },
      })
      if (execution.id !== operationExecutionId) throw new Error('TASK_DEPENDENCY_GATE_EXECUTION_ID_DIVERGED')
      const rows = await persistSubmittedTaskBatchInTransaction({
        tx,
        inputs: prepared,
        onBatchCreatedInTransaction: async (transaction, tasks) => {
          for (const task of tasks) {
            await reserveWorkspaceResourceInTransaction(transaction, {
              resourceId: task.task.targetId,
              userId,
              projectId,
              outputPath: `dependency-gate/${task.task.id}`,
              mediaType: 'video',
              schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO,
              operationId,
              operationExecutionId,
              taskId: task.task.id,
              inputHash: 'd'.repeat(64),
              generationOptions: { mergeMode: 'dependency_gate_test' },
            })
          }
          await followUpBatchBinding.bindInTransaction(transaction, {
            operationId,
            taskIds: tasks.map(({ task }) => task.id),
          })
        },
      })
      await persistPlannedTaskEdgesInTransaction({
        tx,
        operationExecutionId,
        taskEdges: [
          { sourceTaskPlanId: 'task:0', targetTaskPlanId: 'task:2', requirement: 'required_success' },
          { sourceTaskPlanId: 'task:1', targetTaskPlanId: 'task:2', requirement: 'required_success' },
        ],
        persistedTasks: rows.map(({ task }) => ({ id: task.id, operationPlanTaskId: task.operationPlanTaskId })),
      })
      await tx.operationExecution.update({
        where: { id: operationExecutionId },
        data: { status: 'completed', completedAt: new Date(), output: json({ ok: true }) },
      })
      return rows
    },
    { maxWait: 10_000, timeout: 30_000 },
  )
  const [source1, source2, mix] = persisted.map(({ task }) => task)
  if (!source1 || !source2 || !mix) throw new Error('TASK_DEPENDENCY_GATE_TASKS_MISSING')
  for (const [index, task] of [source1, source2].entries()) {
    const outcome = task.id === source1.id ? input.sourceOutcomes[0] : input.sourceOutcomes[1]
    const mediaId = mediaObjectIds[index]
    if (!mediaId) throw new Error('TASK_DEPENDENCY_GATE_SOURCE_MEDIA_MISSING')
    await seedCheckpoint(task.id, { mediaId }, outcome === 'failed')
  }
  await prisma.projectAgentTurn.update({
    where: { id: originTurnId },
    data: { status: 'completed', finishedAt: new Date() },
  })
  const batch = await prisma.followUpBatch.findUniqueOrThrow({
    where: { executionKey: operationExecutionId },
    select: { id: true },
  })
  const sourceReferences = {
    source1: { taskId: source1.id, userId, taskType: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE, dependsOnTaskIds: [] as const },
    source2: { taskId: source2.id, userId, taskType: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE, dependsOnTaskIds: [] as const },
    mix: { taskId: mix.id, userId, taskType: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE, dependsOnTaskIds: [source1.id, source2.id] as const },
  }
  return {
    userId,
    projectId,
    threadId,
    originTurnId,
    operationExecutionId,
    followUpBatchId: batch.id,
    source1TaskId: source1.id,
    source2TaskId: source2.id,
    mixTaskId: mix.id,
    references: sourceReferences,
    sourceOutcomes: input.sourceOutcomes,
    mediaObjectIds,
    resourceIds,
  }
}

export async function removeTaskDependencyGateFixture(
  fixture: TaskDependencyGateFixture,
): Promise<void> {
  await prisma.followUpBatch.deleteMany({ where: { id: fixture.followUpBatchId } })
  await prisma.taskExecutionCheckpoint.deleteMany({ where: { taskId: { in: [fixture.source1TaskId, fixture.source2TaskId, fixture.mixTaskId] } } })
  await prisma.workspaceResource.deleteMany({ where: { id: { in: [...fixture.resourceIds] } } })
  await prisma.task.deleteMany({ where: { id: { in: [fixture.source1TaskId, fixture.source2TaskId, fixture.mixTaskId] } } })
  await prisma.operationExecution.deleteMany({ where: { id: fixture.operationExecutionId } })
  await prisma.projectAgentTurn.deleteMany({ where: { id: fixture.originTurnId } })
  await prisma.projectAssistantThread.deleteMany({ where: { id: fixture.threadId } })
  await prisma.project.deleteMany({ where: { id: fixture.projectId } })
  await prisma.user.deleteMany({ where: { id: fixture.userId } })
  await prisma.mediaObject.deleteMany({ where: { id: { in: [...fixture.mediaObjectIds] } } })
}
