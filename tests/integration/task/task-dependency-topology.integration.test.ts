import { beforeEach, describe, expect, it } from 'vitest'
import { persistPlannedTaskEdgesInTransaction } from '@/lib/task/dependencies/persistence'
import {
  buildPersistedTaskReference,
  buildPersistedTaskReferencesForOperationExecution,
  projectPersistedTaskReference,
} from '@/lib/task/dependencies/references'
import { persistSubmittedTaskBatchInTransaction } from '@/lib/task/transactional-create'
import { TASK_STATUS, TASK_TYPE, type CreateTaskInput } from '@/lib/task/types'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { prisma } from '../../helpers/prisma'

function buildInputs(params: {
  readonly userId: string
  readonly projectId: string
  readonly operationExecutionId: string
}): readonly CreateTaskInput[] {
  return ['01:narration:1', '02:narration:2', '03:mix:1'].map((operationPlanTaskId) => ({
    userId: params.userId,
    projectId: params.projectId,
    type: TASK_TYPE.WORKSPACE_RESOURCE_AUDIO,
    targetType: 'WorkspaceResource',
    targetId: `resource-${operationPlanTaskId}`,
    payload: {
      lifecycleProjection: {
        resources: [{
          resourceId: `resource-${operationPlanTaskId}`,
          mediaType: 'audio',
          schemaId: 'generic.audio',
          name: operationPlanTaskId,
        }],
      },
      resourceId: `resource-${operationPlanTaskId}`,
    },
    operationExecutionId: params.operationExecutionId,
    operationPlanTaskId,
  }))
}

async function createCommittingExecution(params: {
  readonly userId: string
  readonly projectId: string
  readonly requestId: string
}) {
  return await prisma.operationExecution.create({
    data: {
      userId: params.userId,
      scopeKind: 'project',
      scopeId: params.projectId,
      projectId: params.projectId,
      operationId: 'test.voiceover.topology',
      requestId: params.requestId,
      status: 'committing',
    },
  })
}

describe('Persisted Task dependency topology projection', () => {
  it('rejects a persisted dependency whose requirement is not required_success', () => {
    const operationExecutionId = 'operation-execution-1'
    const target = {
      id: 'target-task',
      userId: 'user-1',
      projectId: 'project-1',
      operationExecutionId,
      operationPlanTaskId: '02:mix',
      type: TASK_TYPE.WORKSPACE_RESOURCE_AUDIO,
    }
    const source = {
      id: 'source-task',
      userId: 'user-1',
      projectId: 'project-1',
      operationExecutionId,
      operationPlanTaskId: '01:narration',
      type: TASK_TYPE.WORKSPACE_RESOURCE_AUDIO,
    }

    expect(() => projectPersistedTaskReference({
      task: target,
      dependencies: [{
        operationExecutionId,
        targetTaskId: target.id,
        sourceTaskId: source.id,
        requirement: 'optional',
        targetTask: target,
        sourceTask: source,
      }],
    })).toThrow(/^TASK_DEPENDENCY_TOPOLOGY_DIVERGED/)
  })
})

describe('Task dependency topology persistence', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('persists immutable required-success edges while every Task remains queued', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const execution = await createCommittingExecution({
      userId: user.id,
      projectId: project.id,
      requestId: 'topology-success',
    })
    const taskIdsByPlanId = new Map<string, string>()

    await prisma.$transaction(async (tx) => {
      const persisted = await persistSubmittedTaskBatchInTransaction({
        tx,
        inputs: buildInputs({
          userId: user.id,
          projectId: project.id,
          operationExecutionId: execution.id,
        }),
      })
      for (const { task } of persisted) {
        if (task.operationPlanTaskId) taskIdsByPlanId.set(task.operationPlanTaskId, task.id)
      }
      await persistPlannedTaskEdgesInTransaction({
        tx,
        operationExecutionId: execution.id,
        persistedTasks: persisted.map(({ task }) => ({
          id: task.id,
          operationPlanTaskId: task.operationPlanTaskId,
        })),
        taskEdges: [
          { sourceTaskPlanId: '01:narration:1', targetTaskPlanId: '03:mix:1', requirement: 'required_success' },
          { sourceTaskPlanId: '02:narration:2', targetTaskPlanId: '03:mix:1', requirement: 'required_success' },
        ],
      })
    })

    await expect(prisma.task.findMany({
      where: { operationExecutionId: execution.id },
      select: { status: true },
    })).resolves.toEqual([
      { status: TASK_STATUS.QUEUED },
      { status: TASK_STATUS.QUEUED },
      { status: TASK_STATUS.QUEUED },
    ])
    const dependencies = await prisma.taskDependency.findMany({
      where: { operationExecutionId: execution.id },
      select: {
        operationExecutionId: true,
        targetTaskId: true,
        sourceTaskId: true,
        requirement: true,
      },
      orderBy: { sourceTaskId: 'asc' },
    })
    expect(dependencies).toHaveLength(2)
    expect(dependencies).toEqual(expect.arrayContaining([
      {
        operationExecutionId: execution.id,
        sourceTaskId: taskIdsByPlanId.get('01:narration:1'),
        targetTaskId: taskIdsByPlanId.get('03:mix:1'),
        requirement: 'required_success',
      },
      {
        operationExecutionId: execution.id,
        sourceTaskId: taskIdsByPlanId.get('02:narration:2'),
        targetTaskId: taskIdsByPlanId.get('03:mix:1'),
        requirement: 'required_success',
      },
    ]))
    const source1 = taskIdsByPlanId.get('01:narration:1')
    const source2 = taskIdsByPlanId.get('02:narration:2')
    const mix = taskIdsByPlanId.get('03:mix:1')
    if (!source1 || !source2 || !mix) throw new Error('TEST_TASK_MAPPING_MISSING')
    const [source1Task, source2Task, mixTask] = await Promise.all([
      prisma.task.findUniqueOrThrow({ where: { id: source1 }, select: { id: true, type: true } }),
      prisma.task.findUniqueOrThrow({ where: { id: source2 }, select: { id: true, type: true } }),
      prisma.task.findUniqueOrThrow({ where: { id: mix }, select: { id: true, type: true } }),
    ])
    const references = await buildPersistedTaskReferencesForOperationExecution(prisma, execution.id)
    expect(references).toEqual([
      { taskId: source1Task.id, userId: user.id, taskType: source1Task.type, dependsOnTaskIds: [] },
      { taskId: source2Task.id, userId: user.id, taskType: source2Task.type, dependsOnTaskIds: [] },
      {
        taskId: mixTask.id,
        userId: user.id,
        taskType: mixTask.type,
        dependsOnTaskIds: [source1Task.id, source2Task.id].sort(),
      },
    ])
    await prisma.taskDependency.update({
      where: { targetTaskId_sourceTaskId: { targetTaskId: mix, sourceTaskId: source1 } },
      data: { operationExecutionId: (await createCommittingExecution({
        userId: user.id,
        projectId: project.id,
        requestId: 'topology-diverged',
      })).id },
    })
    await expect(buildPersistedTaskReference(prisma, mix)).rejects.toThrow(
      'TASK_DEPENDENCY_TOPOLOGY_DIVERGED',
    )
    const lifecycleColumns = await prisma.$queryRaw<Array<{ COLUMN_NAME: string }>>`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'task_dependencies'
        AND COLUMN_NAME IN ('status', 'releasedAt', 'settledAt', 'updatedAt')
    `
    expect(lifecycleColumns).toEqual([])
  })

  it('rolls back Tasks and edges when a Plan ID has no persisted Task mapping', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const execution = await createCommittingExecution({
      userId: user.id,
      projectId: project.id,
      requestId: 'topology-missing',
    })

    await expect(prisma.$transaction(async (tx) => {
      const persisted = await persistSubmittedTaskBatchInTransaction({
        tx,
        inputs: buildInputs({
          userId: user.id,
          projectId: project.id,
          operationExecutionId: execution.id,
        }),
      })
      await persistPlannedTaskEdgesInTransaction({
        tx,
        operationExecutionId: execution.id,
        persistedTasks: persisted.map(({ task }) => ({
          id: task.id,
          operationPlanTaskId: task.operationPlanTaskId,
        })),
        taskEdges: [
          { sourceTaskPlanId: '01:narration:missing', targetTaskPlanId: '03:mix:1', requirement: 'required_success' },
        ],
      })
    })).rejects.toThrow('OPERATION_PLAN_TASK_EDGE_MAPPING_MISSING')

    await expect(prisma.task.count({
      where: { operationExecutionId: execution.id },
    })).resolves.toBe(0)
    await expect(prisma.taskDependency.count({
      where: { operationExecutionId: execution.id },
    })).resolves.toBe(0)
  })

  it('rejects reuse of one persisted Task ID for two Plan IDs', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const execution = await createCommittingExecution({
      userId: user.id,
      projectId: project.id,
      requestId: 'topology-identity-diverged',
    })

    await expect(prisma.$transaction(async (tx) => {
      const persisted = await persistSubmittedTaskBatchInTransaction({
        tx,
        inputs: buildInputs({
          userId: user.id,
          projectId: project.id,
          operationExecutionId: execution.id,
        }),
      })
      const firstTask = persisted[0]?.task
      if (!firstTask) throw new Error('TEST_TASK_MISSING')
      await persistPlannedTaskEdgesInTransaction({
        tx,
        operationExecutionId: execution.id,
        persistedTasks: [
          { id: firstTask.id, operationPlanTaskId: '01:narration:1' },
          { id: firstTask.id, operationPlanTaskId: '02:narration:2' },
        ],
        taskEdges: [
          { sourceTaskPlanId: '01:narration:1', targetTaskPlanId: '02:narration:2', requirement: 'required_success' },
        ],
      })
    })).rejects.toThrow('OPERATION_PLAN_TASK_IDENTITY_DIVERGED')

    await expect(prisma.task.count({
      where: { operationExecutionId: execution.id },
    })).resolves.toBe(0)
  })
})
