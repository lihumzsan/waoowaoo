export type TaskTerminalFence =
  | { kind: 'attempt'; attempt: number }
  | { kind: 'snapshot'; updatedAt: Date }
  | { kind: 'active' }

type TaskTerminalBase = {
  taskId: string
  fence: TaskTerminalFence
  eventPayload?: Record<string, unknown> | null
}

export type TaskTerminalCommitIntent =
  | (TaskTerminalBase & {
      kind: 'completed'
      executionCheckpointId: string
    })
  | (TaskTerminalBase & {
      kind: 'failed'
      errorCode: string
      errorMessage: string
      errorDetails?: Record<string, unknown> | null
      source: 'worker' | 'workflow' | 'timeout'
    })
  | (TaskTerminalBase & {
      kind: 'canceled'
      reason: string
      source: 'user' | 'system'
    })

export type TaskTerminalCommitResult =
  | {
      applied: true
      status: 'completed' | 'failed' | 'canceled'
      terminalEventId: number
      readyFollowUpBatchIds: readonly string[]
    }
  | {
      applied: false
      reason: 'already_terminal'
      existingStatus: string
      terminalEventId: number
      readyFollowUpBatchIds: readonly string[]
    }
  | {
      applied: false
      reason: 'stale_fence'
      existingStatus: string
      terminalEventId: null
      readyFollowUpBatchIds: readonly []
    }
  | {
      applied: false
      reason: 'completion_pending'
      existingStatus: string
      terminalEventId: null
      readyFollowUpBatchIds: readonly []
    }
