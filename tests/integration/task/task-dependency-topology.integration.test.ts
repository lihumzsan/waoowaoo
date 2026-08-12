import { beforeEach, describe, expect, it } from 'vitest'
import { persistPlannedTaskEdgesInTransaction } from '@/lib/task/dependencies/persistence'
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
  return ['narration:1', 'narration:2', 'mix:1'].map((operationPlanTaskId) => ({
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

    await prisma.$transaction(async (tx) => {
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
          { sourceTaskPlanId: 'narration:1', targetTaskPlanId: 'mix:1', requirement: 'required_success' },
          { sourceTaskPlanId: 'narration:2', targetTaskPlanId: 'mix:1', requirement: 'required_success' },
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
    expect(dependencies.every((dependency) =>
      dependency.operationExecutionId === execution.id
      && dependency.requirement === 'required_success',
    )).toBe(true)
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
          { sourceTaskPlanId: 'narration:missing', targetTaskPlanId: 'mix:1', requirement: 'required_success' },
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
})
