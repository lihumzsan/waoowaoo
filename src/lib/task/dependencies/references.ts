import type { PrismaClient } from '@prisma/client'
import type { PersistedTaskReference } from '@/lib/temporal/task/contracts'
import { isTaskType, type TaskType } from '@/lib/task/types'

type DependencyClient = Pick<PrismaClient, 'task' | 'taskDependency'>

export type PersistedTaskRow = {
  readonly id: string
  readonly userId: string
  readonly projectId: string
  readonly operationExecutionId: string | null
  readonly operationPlanTaskId: string | null
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
  throw new Error(['TASK_DEPENDENCY_TOPOLOGY_DIVERGED', ...details].join(':'))
}

function requireTaskType(task: PersistedTaskRow): TaskType {
  if (!isTaskType(task.type)) topologyDiverged(task.id, 'TASK_TYPE_INVALID', task.type)
  return task.type
}

function requireOperationTask(task: PersistedTaskRow, operationExecutionId: string): void {
  if (
    task.operationExecutionId !== operationExecutionId ||
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
  if (
    dependency.requirement !== 'required_success' ||
    dependency.targetTaskId !== target.id ||
    dependency.targetTask.id !== target.id ||
    dependency.operationExecutionId !== target.operationExecutionId ||
    dependency.targetTask.operationExecutionId !== target.operationExecutionId ||
    dependency.sourceTask.operationExecutionId !== target.operationExecutionId ||
    dependency.targetTask.userId !== target.userId ||
    dependency.sourceTask.userId !== target.userId ||
    dependency.targetTask.projectId !== target.projectId ||
    dependency.sourceTask.projectId !== target.projectId ||
    !isTaskType(dependency.targetTask.type) ||
    !isTaskType(dependency.sourceTask.type)
  ) {
    topologyDiverged(target.id, dependency.sourceTaskId)
  }
}

export function projectPersistedTaskReference(params: {
  readonly task: PersistedTaskRow
  readonly dependencies: readonly PersistedDependencyRow[]
}): PersistedTaskReference {
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
  type: true,
} as const

const persistedDependencyInclude = {
  requirement: true,
  targetTask: { select: persistedTaskSelect },
  sourceTask: { select: persistedTaskSelect },
} as const

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
    include: persistedDependencyInclude,
  })
  return projectPersistedTaskReference({ task, dependencies })
}

export async function buildPersistedTaskReferencesForOperationExecution(
  client: DependencyClient,
  operationExecutionId: string,
): Promise<readonly PersistedTaskReference[]> {
  const tasks = await client.task.findMany({
    where: { operationExecutionId },
    select: persistedTaskSelect,
    orderBy: { operationPlanTaskId: 'asc' },
  })
  for (const task of tasks) requireOperationTask(task, operationExecutionId)
  const taskIds = tasks.map((task) => task.id)
  const dependencies = await client.taskDependency.findMany({
    where: {
      OR: [
        { operationExecutionId },
        { targetTaskId: { in: taskIds } },
        { sourceTaskId: { in: taskIds } },
      ],
    },
    include: persistedDependencyInclude,
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
