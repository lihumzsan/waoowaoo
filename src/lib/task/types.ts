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
  IMAGE_PANEL: 'image_panel',
  EDIT_STYLE_PREVIEW_OPTIONS_GENERATE: 'edit_style_preview_options_generate',
  EDIT_STYLE_PREVIEW_IMAGE: 'edit_style_preview_image',
  IMAGE_CHARACTER: 'image_character',
  IMAGE_LOCATION: 'image_location',
  CONTINUITY_EXPERIMENT_IMAGE: 'continuity_experiment_image',
  MUSIC_GENERATE: 'music_generate',
  MUSIC_SCORE_PLAN: 'music_score_plan',
  MUSIC_SCORE_GENERATE: 'music_score_generate',
  SOUNDSCAPE_PLAN: 'soundscape_plan',
  SOUNDSCAPE_GENERATE: 'soundscape_generate',
  FINAL_VIDEO_RENDER: 'final_video_render',
  CHAPTER_RENDER: 'chapter_render',
  VIDEO_PANEL: 'video_panel',
  VIDEO_GROUP: 'video_group',
  MODIFY_ASSET_IMAGE: 'modify_asset_image',
  REGENERATE_GROUP: 'regenerate_group',
  ASSET_HUB_IMAGE: 'asset_hub_image',
  ASSET_HUB_MODIFY: 'asset_hub_modify',
  EDIT_SOURCE_SCRIPT_GENERATE: 'edit_source_script_generate',
  EDIT_BIBLE_GENERATE: 'edit_bible_generate',
  EDIT_SCRIPT_GENERATE: 'edit_script_generate',
  EDIT_SHOT_EXECUTION_PLAN_GENERATE: 'edit_shot_execution_plan_generate',
  AI_MODIFY_APPEARANCE: 'ai_modify_appearance',
  AI_MODIFY_LOCATION: 'ai_modify_location',
  AI_MODIFY_PROP: 'ai_modify_prop',
  AI_CREATE_CHARACTER: 'ai_create_character',
  AI_CREATE_LOCATION: 'ai_create_location',
  REFERENCE_TO_CHARACTER: 'reference_to_character',
  REFERENCE_CHARACTER_DESCRIPTION_EXTRACT: 'reference_character_description_extract',
  ASSET_HUB_AI_DESIGN_CHARACTER: 'asset_hub_ai_design_character',
  ASSET_HUB_AI_DESIGN_LOCATION: 'asset_hub_ai_design_location',
  ASSET_HUB_AI_MODIFY_CHARACTER: 'asset_hub_ai_modify_character',
  ASSET_HUB_AI_MODIFY_LOCATION: 'asset_hub_ai_modify_location',
  ASSET_HUB_AI_MODIFY_PROP: 'asset_hub_ai_modify_prop',
  ASSET_HUB_REFERENCE_TO_CHARACTER: 'asset_hub_reference_to_character',
  ASSET_HUB_REFERENCE_CHARACTER_DESCRIPTION_EXTRACT: 'asset_hub_reference_character_description_extract',
} as const

export type TaskType = (typeof TASK_TYPE)[keyof typeof TASK_TYPE]

export type QueueType = 'image' | 'video' | 'music' | 'text'

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
    apiType: 'text' | 'image' | 'video' | 'music' | 'sound_effect'
    model: string
    quantity: number
    unit: 'token' | 'image' | 'video' | 'second' | 'call'
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
  | 'editScript'
  | 'editShotExecutionPlan'
  | 'storyboards'
  | 'projectAssets'
  | 'globalAssets'
  | 'videos'
  | 'episodeData'
  | 'projectData'
  | 'projectContext'

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
