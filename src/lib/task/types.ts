import type { Locale } from '@/i18n/routing'

export const TASK_STATUS = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELED: 'canceled',
  DISMISSED: 'dismissed',
} as const

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS]

export const TASK_EVENT_TYPE = {
  CREATED: 'task.created',
  PROCESSING: 'task.processing',
  PROGRESS: 'task.progress',
  COMPLETED: 'task.completed',
  FAILED: 'task.failed',
  CANCELED: 'task.canceled',
} as const

export type TaskEventType = (typeof TASK_EVENT_TYPE)[keyof typeof TASK_EVENT_TYPE]

export const TASK_LIFECYCLE_EVENT_TYPES = [
  TASK_EVENT_TYPE.CREATED,
  TASK_EVENT_TYPE.PROCESSING,
  TASK_EVENT_TYPE.PROGRESS,
  TASK_EVENT_TYPE.COMPLETED,
  TASK_EVENT_TYPE.FAILED,
  TASK_EVENT_TYPE.CANCELED,
] as const

export type TaskLifecycleEventType = (typeof TASK_LIFECYCLE_EVENT_TYPES)[number]

export const TASK_TERMINAL_EVENT_TYPES = [
  TASK_EVENT_TYPE.COMPLETED,
  TASK_EVENT_TYPE.FAILED,
  TASK_EVENT_TYPE.CANCELED,
] as const

export type TaskTerminalEventType = (typeof TASK_TERMINAL_EVENT_TYPES)[number]

export function isTaskTerminalEventType(value: string | null | undefined): value is TaskTerminalEventType {
  return value === TASK_EVENT_TYPE.COMPLETED
    || value === TASK_EVENT_TYPE.FAILED
    || value === TASK_EVENT_TYPE.CANCELED
}

export const TASK_TYPE = {
  WORKSPACE_RESOURCE_IMAGE: 'workspace_resource_image',
  WORKSPACE_RESOURCE_AUDIO: 'workspace_resource_audio',
  WORKSPACE_RESOURCE_VOICE: 'workspace_resource_voice',
  WORKSPACE_RESOURCE_VIDEO: 'workspace_resource_video',
  WORKSPACE_RESOURCE_VIDEO_MERGE: 'workspace_resource_video_merge',
} as const

export type TaskType = (typeof TASK_TYPE)[keyof typeof TASK_TYPE]

const TASK_TYPE_VALUES: ReadonlySet<string> = new Set(Object.values(TASK_TYPE))

export function isTaskType(value: unknown): value is TaskType {
  return typeof value === 'string' && TASK_TYPE_VALUES.has(value)
}

export type BillingMode = 'OFF' | 'SHADOW' | 'ENFORCE'

export type TaskBillingInfo =
  | {
    billable: false
    source?: 'task'
    status?: 'skipped'
  }
  | {
    billable: true
    source: 'task'
    taskType: TaskType
    apiType: 'text' | 'image' | 'video' | 'music' | 'voice'
    model: string
    quantity: number
    unit: 'token' | 'image' | 'video' | 'second' | 'call' | 'character'
    maxFrozenCost: number
    pricingVersion?: string
    action: string
    metadata?: Record<string, unknown>
    billingKey?: string
    freezeId?: string | null
    modeSnapshot?: BillingMode | null
    status?: 'skipped' | 'quoted' | 'frozen' | 'settled' | 'rolled_back' | 'failed'
    chargedCost?: number
  }

export type TaskExecutionData = {
  taskId: string
  parentTaskId?: string | null
  type: TaskType
  locale: Locale
  projectId: string
  targetType: string
  targetId: string
  payload?: Record<string, unknown> | null
  billingInfo?: TaskBillingInfo | null
  userId: string
  operationId?: string | null
  operationSource?: string | null
  approvalGrantId?: string | null
  operationExecutionId?: string | null
  operationPlanTaskId?: string | null
  operationRequestId?: string | null
  trace?: {
    requestId?: string | null
  } | null
}

export type WorkspaceResourceName =
  | 'globalAssets'
  | 'projectData'
  | 'workspaceResources'

export type WorkspaceResourceRef = {
  kind: WorkspaceResourceName
  projectId: string
}

export type CreateTaskInput = {
  userId: string
  projectId: string
  parentTaskId?: string | null
  type: TaskType
  targetType: string
  targetId: string
  payload?: Record<string, unknown> | null
  dedupeKey?: string | null
  billingInfo?: TaskBillingInfo | null
  operationId?: string | null
  operationSource?: string | null
  approvalGrantId?: string | null
  operationExecutionId?: string | null
  operationPlanTaskId?: string | null
  operationRequestId?: string | null
}
