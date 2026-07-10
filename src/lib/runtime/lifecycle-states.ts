export type OperationTaskRef = {
  readonly taskId: string
  readonly taskType?: string
  readonly targetType?: string
  readonly targetId?: string
}

export type OperationSubmissionState =
  | { readonly phase: 'submitting' }
  | { readonly phase: 'submitted'; readonly taskRefs: readonly OperationTaskRef[] }
  | { readonly phase: 'rejected'; readonly errorCode: string; readonly message: string }

export type TaskExecutionState =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type ArtifactState = 'absent' | 'pending' | 'ready' | 'failed'
