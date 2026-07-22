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

export const TASK_SSE_EVENT_TYPE = {
  LIFECYCLE: 'task.lifecycle',
  STREAM: 'task.stream',
} as const

export const WORKSPACE_SSE_EVENT_TYPE = {
  MUTATION_BATCH: 'mutation.batch',
  RESOURCE_CHANGED: 'resource.changed',
  ASSISTANT_SESSION_CHANGED: 'assistant.session.changed',
} as const

export type TaskSSEEventType = (typeof TASK_SSE_EVENT_TYPE)[keyof typeof TASK_SSE_EVENT_TYPE]
export type WorkspaceSSEEventType = (typeof WORKSPACE_SSE_EVENT_TYPE)[keyof typeof WORKSPACE_SSE_EVENT_TYPE]

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
  CREATIVE_WORK: 'creative_work',
  CREATIVE_RESOURCE_IMAGE: 'creative_resource_image',
  CREATIVE_RESOURCE_AUDIO: 'creative_resource_audio',
  CREATIVE_RESOURCE_VOICE: 'creative_resource_voice',
  CREATIVE_RESOURCE_VIDEO: 'creative_resource_video',
  CREATIVE_RESOURCE_VIDEO_MERGE: 'creative_resource_video_merge',
} as const

export type TaskType = (typeof TASK_TYPE)[keyof typeof TASK_TYPE]

const TASK_TYPE_VALUES: ReadonlySet<string> = new Set(Object.values(TASK_TYPE))

export function isTaskType(value: unknown): value is TaskType {
  return typeof value === 'string' && TASK_TYPE_VALUES.has(value)
}

export type QueueType = 'image' | 'video' | 'music' | 'voice' | 'text'

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

export type TaskJobData = {
  taskId: string
  parentTaskId?: string | null
  type: TaskType
  locale: Locale
  projectId: string
  episodeId?: string | null
  targetType: string
  targetId: string
  payload?: Record<string, unknown> | null
  batchKey?: string | null
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

export type TaskJobEnvelope = {
  data: TaskJobData
  priority: number
}

export type TaskSSEEvent = {
  id: string
  type: TaskSSEEventType
  taskId: string
  projectId: string
  userId: string
  ts: string
  taskType?: string | null
  targetType?: string | null
  targetId?: string | null
  episodeId?: string | null
  payload?: (Record<string, unknown> & {
    lifecycleType?: TaskLifecycleEventType
    coveredTargets?: readonly { readonly targetType: string; readonly targetId: string }[]
    affectedResources?: readonly WorkspaceResourceRef[]
  }) | null
}

export type MutationBatchSSEEvent = {
  id: string
  type: typeof WORKSPACE_SSE_EVENT_TYPE.MUTATION_BATCH
  mutationBatchId: string
  projectId: string
  userId: string
  ts: string
  operationId: string | null
  episodeId: string | null
  targets: Array<{ targetType: string; targetId: string }>
}

export type WorkspaceResourceName =
  | 'editBible'
  | 'projectAssets'
  | 'globalAssets'
  | 'episodeData'
  | 'projectData'
  | 'projectContext'
  | 'creativeResources'

export type WorkspaceResourceRef = {
  kind: WorkspaceResourceName
  projectId: string
  episodeId?: string | null
}

export type ResourceChangedSSEEvent = {
  id: string
  type: typeof WORKSPACE_SSE_EVENT_TYPE.RESOURCE_CHANGED
  projectId: string
  userId: string
  ts: string
  affectedResources: WorkspaceResourceRef[]
}

export type AssistantSessionChangedSSEEvent = {
  id: string
  type: typeof WORKSPACE_SSE_EVENT_TYPE.ASSISTANT_SESSION_CHANGED
  projectId: string
  userId: string
  ts: string
  episodeId: string | null
  assistantId: string
  scopeRef: string
  agentEventId: string
}

export type SSEEvent =
  | TaskSSEEvent
  | MutationBatchSSEEvent
  | ResourceChangedSSEEvent
  | AssistantSessionChangedSSEEvent

export type CreateTaskInput = {
  userId: string
  projectId: string
  parentTaskId?: string | null
  episodeId?: string | null
  type: TaskType
  targetType: string
  targetId: string
  payload?: Record<string, unknown> | null
  dedupeKey?: string | null
  batchKey?: string | null
  priority?: number
  billingInfo?: TaskBillingInfo | null
  operationId?: string | null
  operationSource?: string | null
  approvalGrantId?: string | null
  operationExecutionId?: string | null
  operationPlanTaskId?: string | null
  operationRequestId?: string | null
}
