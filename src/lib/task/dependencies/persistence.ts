import type { Prisma } from '@prisma/client'
import type { PlannedTaskEdge } from '@/lib/operations/planning'

type PersistedTaskPlanIdentity = {
  readonly id: string
  readonly operationPlanTaskId: string | null
}

function buildPersistedTaskIdByPlanId(
  persistedTasks: readonly PersistedTaskPlanIdentity[],
): ReadonlyMap<string, string> {
  const persistedTaskIdByPlanId = new Map<string, string>()
  const planIdByPersistedTaskId = new Map<string, string>()
  for (const persistedTask of persistedTasks) {
    const operationPlanTaskId = persistedTask.operationPlanTaskId
    if (!operationPlanTaskId) {
      throw new Error(`OPERATION_PLAN_TASK_EDGE_MAPPING_MISSING:${persistedTask.id}`)
    }
    if (persistedTaskIdByPlanId.has(operationPlanTaskId)) {
      throw new Error(`OPERATION_PLAN_TASK_IDENTITY_DIVERGED:${operationPlanTaskId}`)
    }
    const existingPlanId = planIdByPersistedTaskId.get(persistedTask.id)
    if (existingPlanId) {
      throw new Error(`OPERATION_PLAN_TASK_IDENTITY_DIVERGED:${existingPlanId}:${operationPlanTaskId}`)
    }
    persistedTaskIdByPlanId.set(operationPlanTaskId, persistedTask.id)
    planIdByPersistedTaskId.set(persistedTask.id, operationPlanTaskId)
  }
  return persistedTaskIdByPlanId
}

function resolvePersistedTaskId(params: {
  readonly persistedTaskIdByPlanId: ReadonlyMap<string, string>
  readonly operationPlanTaskId: string
}): string {
  const taskId = params.persistedTaskIdByPlanId.get(params.operationPlanTaskId)
  if (!taskId) {
    throw new Error(`OPERATION_PLAN_TASK_EDGE_MAPPING_MISSING:${params.operationPlanTaskId}`)
  }
  return taskId
}

export async function persistPlannedTaskEdgesInTransaction(params: {
  readonly tx: Prisma.TransactionClient
  readonly operationExecutionId: string
  readonly taskEdges: readonly PlannedTaskEdge[]
  readonly persistedTasks: readonly PersistedTaskPlanIdentity[]
}): Promise<void> {
  const persistedTaskIdByPlanId = buildPersistedTaskIdByPlanId(params.persistedTasks)
  if (params.taskEdges.length === 0) return

  await params.tx.taskDependency.createMany({
    data: params.taskEdges.map((taskEdge) => ({
      operationExecutionId: params.operationExecutionId,
      targetTaskId: resolvePersistedTaskId({
        persistedTaskIdByPlanId,
        operationPlanTaskId: taskEdge.targetTaskPlanId,
      }),
      sourceTaskId: resolvePersistedTaskId({
        persistedTaskIdByPlanId,
        operationPlanTaskId: taskEdge.sourceTaskPlanId,
      }),
      requirement: taskEdge.requirement,
    })),
  })
}
