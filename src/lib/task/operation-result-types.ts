export type OperationResultStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'canceled'

export type RecentOperationMediaType = 'image' | 'video' | 'audio' | 'music'

export interface RecentOperationMedia {
  mediaId?: string | null
  mediaType: RecentOperationMediaType
  url?: string | null
  storageKey?: string | null
  mimeType?: string | null
  width?: number | null
  height?: number | null
  durationMs?: number | null
}

export interface RecentOperationError {
  code: string
  category: string
  retryable: boolean
  action: 'ask_user' | 'inform_user' | 'revise_input' | 'stop' | 'wait'
}

export interface RecentOperationResult {
  operationId: string
  taskId: string
  taskType: string
  status: OperationResultStatus
  source?: string | null
  approvalGrantId?: string | null
  operationExecutionId?: string | null
  targetType: string
  targetId: string
  provider?: string | null
  model?: string | null
  media?: RecentOperationMedia | null
  error?: RecentOperationError | null
  submittedAt: string
  completedAt?: string | null
}
