import type { Locale } from '@/i18n/routing'
import type { TaskType } from '@/lib/task/types'

export type OperationPlanKind = 'task_submission'

export interface PlannedTaskTarget {
  targetType: string
  targetId: string
}

export interface PlannedTask {
  id: string
  taskType: TaskType
  target: PlannedTaskTarget
  payload: Record<string, unknown>
  dedupeKey?: string | null
  locale: Locale
}

export interface PlannedTaskDependency {
  taskId: string
  taskType: TaskType
  target: PlannedTaskTarget
}

export interface PlannedTaskEdge {
  readonly sourceTaskPlanId: string
  readonly targetTaskPlanId: string
  readonly requirement: 'required_success'
}

export interface OperationPlan {
  kind: OperationPlanKind
  operationId: string
  projectId: string
  userId: string
  tasks: PlannedTask[]
  taskDependencies?: PlannedTaskDependency[]
  taskEdges?: readonly PlannedTaskEdge[]
  reservedIdentityIds?: string[]
  summary?: string | null
  metadata?: Record<string, unknown>
}

export interface OperationPlanView {
  /** Stable API generation intent carried unchanged through plan/grant/execute. */
  operationRequestId?: string
  planSnapshotId?: string
  inputHash?: string
  planHash?: string
  operationId: string
  kind: OperationPlanKind
  taskCount: number
  tasks: Array<{
    id: string
    taskType: TaskType
    targetType: string
    targetId: string
  }>
}
