import { Prisma, type PrismaClient } from '@prisma/client'
import type { PersistedTaskReference } from '@/lib/temporal/task/contracts'
import { TaskDependencyTopologyDivergedError } from '@/lib/temporal/task/scheduled-request'
import { isTaskType, type TaskType } from '@/lib/task/types'

type DependencyClient = Pick<PrismaClient, 'task' | 'taskDependency' | 'operationExecution'>

export type PersistedTaskRow = {
  readonly id: string
  readonly userId: string
  readonly projectId: string
  readonly operationExecutionId: string | null
  readonly operationPlanTaskId: string | null
  readonly operationExecution: {
    readonly executionKind: string
  } | null
  readonly type: string
}

export type PersistedDependencyRow = {
  readonly operationExecutionId: string
  readonly targetTaskId: string
  readonly sourceTaskId: string
  readonly requirement: string
  readonly targetTask: PersistedTaskRow
  readonly sourceTask: PersistedTaskRow
}

function topologyDiverged(...details: readonly string[]): never {
  throw new TaskDependencyTopologyDivergedError(...details)
}

function requireTaskType(task: PersistedTaskRow): TaskType {
  if (!isTaskType(task.type)) topologyDiverged(task.id, 'TASK_TYPE_INVALID', task.type)
  return task.type
}

function requirePlannedOperationTask(
  task: PersistedTaskRow,
  operationExecutionId: string,
): void {
  if (
    task.operationExecutionId !== operationExecutionId ||
    task.operationExecution?.executionKind !== 'planned' ||
    !task.operationPlanTaskId ||
    task.operationPlanTaskId.trim() !== task.operationPlanTaskId
  ) {
    topologyDiverged(task.id, 'OPERATION_TASK_IDENTITY_INVALID')
  }
}

function requireDependencyTopology(params: {
  readonly dependency: PersistedDependencyRow
  readonly target: PersistedTaskRow
}): void {
  const { dependency, target } = params
  const operationExecutionId = target.operationExecutionId
  if (!operationExecutionId) {
    topologyDiverged(target.id, 'OPERATION_TASK_IDENTITY_INVALID')
  }
  requirePlannedOperationTask(target, operationExecutionId)
  requirePlannedOperationTask(dependency.targetTask, operationExecutionId)
  requirePlannedOperationTask(dependency.sourceTask, operationExecutionId)
  if (
    dependency.requirement !== 'required_success' ||
    dependency.targetTaskId !== target.id ||
    dependency.targetTask.id !== target.id ||
    dependency.sourceTask.id !== dependency.sourceTaskId ||
    dependency.sourceTask.id === target.id ||
    dependency.operationExecutionId !== target.operationExecutionId ||
    dependency.targetTask.operationExecutionId !== target.operationExecutionId ||
    dependency.sourceTask.operationExecutionId !== target.operationExecutionId ||
    dependency.targetTask.operationPlanTaskId !== target.operationPlanTaskId ||
    dependency.targetTask.userId !== target.userId ||
    dependency.sourceTask.userId !== target.userId ||
    dependency.targetTask.projectId !== target.projectId ||
    dependency.sourceTask.projectId !== target.projectId ||
    dependency.targetTask.type !== target.type ||
    !isTaskType(dependency.sourceTask.type)
  ) {
    topologyDiverged(target.id, dependency.sourceTaskId)
  }
}

export function projectPersistedTaskReference(params: {
  readonly task: PersistedTaskRow
  readonly dependencies: readonly PersistedDependencyRow[]
}): PersistedTaskReference {
  const { task } = params
  if (task.operationExecutionId === null) {
    if (
      task.operationExecution !== null ||
      task.operationPlanTaskId !== null ||
      params.dependencies.length > 0
    ) {
      topologyDiverged(params.task.id, 'OPERATION_TASK_IDENTITY_INVALID')
    }
  } else if (
    task.operationExecutionId.length === 0 ||
    task.operationExecutionId.trim() !== task.operationExecutionId ||
    !task.operationExecution
  ) {
    topologyDiverged(task.id, 'OPERATION_TASK_IDENTITY_INVALID')
  } else if (task.operationExecution.executionKind === 'direct_task') {
    if (task.operationPlanTaskId !== null || params.dependencies.length > 0) {
      topologyDiverged(params.task.id, 'OPERATION_TASK_IDENTITY_INVALID')
    }
  } else if (task.operationExecution.executionKind === 'planned') {
    requirePlannedOperationTask(task, task.operationExecutionId)
  } else {
    topologyDiverged(task.id, 'OPERATION_EXECUTION_KIND_INVALID')
  }
  const dependsOnTaskIds = params.dependencies
    .map((dependency) => {
      requireDependencyTopology({ dependency, target: params.task })
      return dependency.sourceTaskId
    })
    .sort()
  if (new Set(dependsOnTaskIds).size !== dependsOnTaskIds.length) {
    topologyDiverged(params.task.id, 'DUPLICATE_SOURCE_TASK_ID')
  }
  return {
    taskId: params.task.id,
    userId: params.task.userId,
    taskType: requireTaskType(params.task),
    dependsOnTaskIds,
  }
}

const persistedTaskSelect = {
  id: true,
  userId: true,
  projectId: true,
  operationExecutionId: true,
  operationPlanTaskId: true,
  operationExecution: { select: { executionKind: true } },
  type: true,
} as const satisfies Prisma.TaskSelect

export const persistedDependencySelect = {
  operationExecutionId: true,
  targetTaskId: true,
  sourceTaskId: true,
  requirement: true,
  targetTask: { select: persistedTaskSelect },
  sourceTask: { select: persistedTaskSelect },
} as const satisfies Prisma.TaskDependencySelect

export async function buildPersistedTaskReference(
  client: DependencyClient,
  taskId: string,
): Promise<PersistedTaskReference> {
  const task = await client.task.findUnique({
    where: { id: taskId },
    select: persistedTaskSelect,
  })
  if (!task) topologyDiverged(taskId, 'TASK_NOT_FOUND')
  const dependencies = await client.taskDependency.findMany({
    where: { targetTaskId: task.id },
    select: persistedDependencySelect,
  })
  return projectPersistedTaskReference({ task, dependencies })
}

export async function buildPersistedTaskReferencesForOperationExecution(
  client: DependencyClient,
  operationExecutionId: string,
): Promise<readonly PersistedTaskReference[]> {
  const execution = await client.operationExecution.findUnique({
    where: { id: operationExecutionId },
    select: { executionKind: true },
  })
  if (execution?.executionKind !== 'planned') {
    topologyDiverged(operationExecutionId, 'OPERATION_EXECUTION_KIND_INVALID')
  }
  const tasks = await client.task.findMany({
    where: { operationExecutionId },
    select: persistedTaskSelect,
    orderBy: { operationPlanTaskId: 'asc' },
  })
  for (const task of tasks) requirePlannedOperationTask(task, operationExecutionId)
  const taskIds = tasks.map((task) => task.id)
  const dependencies = await client.taskDependency.findMany({
    where: {
      OR: [
        { operationExecutionId },
        { targetTaskId: { in: taskIds } },
        { sourceTaskId: { in: taskIds } },
      ],
    },
    select: persistedDependencySelect,
  })
  const dependenciesByTargetId = new Map<string, PersistedDependencyRow[]>()
  for (const dependency of dependencies) {
    if (!taskIds.includes(dependency.targetTaskId)) {
      topologyDiverged(operationExecutionId, dependency.targetTaskId)
    }
    const targetDependencies = dependenciesByTargetId.get(dependency.targetTaskId) ?? []
    targetDependencies.push(dependency)
    dependenciesByTargetId.set(dependency.targetTaskId, targetDependencies)
  }
  return tasks.map((task) =>
    projectPersistedTaskReference({ task, dependencies: dependenciesByTargetId.get(task.id) ?? [] }),
  )
}
