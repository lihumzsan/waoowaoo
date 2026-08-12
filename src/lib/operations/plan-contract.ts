import type { Locale } from '@/i18n/routing'
import type { BillingMode, TaskBillingInfo, TaskType } from '@/lib/task/types'

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
  billingInfo: TaskBillingInfo
  dedupeKey?: string | null
  locale: Locale
}

export interface PlannedTaskDependency {
  taskId: string
  taskType: TaskType
  target: PlannedTaskTarget
}

export interface OperationPlan {
  kind: OperationPlanKind
  operationId: string
  projectId: string
  userId: string
  tasks: PlannedTask[]
  taskDependencies?: PlannedTaskDependency[]
  reservedIdentityIds?: string[]
  summary?: string | null
  metadata?: Record<string, unknown>
}

export interface BillingQuoteItemView {
  id: string
  taskType: TaskType
  targetType: string
  targetId: string
  apiType: 'image' | 'video' | 'music' | 'voice'
  model: string
  quantity: number
  unit: 'image' | 'video' | 'music' | 'voice' | 'second' | 'call' | 'character'
  maxFrozenCost?: number
}

export interface BillingQuoteView {
  showCredits: boolean
  billingMode: BillingMode
  billable: boolean
  taskCount: number
  mediaTaskCount: number
  totalMaxFrozenCost?: number
  currency?: 'credits'
  items: BillingQuoteItemView[]
}

export interface OperationPlanView {
  /** Stable API generation intent carried unchanged through plan/grant/execute. */
  operationRequestId?: string
  planSnapshotId?: string
  inputHash?: string
  planHash?: string
  quoteHash?: string
  operationId: string
  kind: OperationPlanKind
  taskCount: number
  quote: BillingQuoteView
  tasks: Array<{
    id: string
    taskType: TaskType
    targetType: string
    targetId: string
  }>
}
