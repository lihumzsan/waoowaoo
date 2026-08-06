export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

export interface ErrorFields {
  name?: string
  message?: string
  stack?: string
  code?: string
  retryable?: boolean
}

export interface LogContext {
  requestId?: string
  providerRequestId?: string
  taskId?: string
  taskAttempt?: number
  threadId?: string
  turnId?: string
  operationId?: string
  projectId?: string
  userId?: string
  provider?: string
  action?: string
  module?: string
}

export interface SemanticContext extends LogContext {
  errorCode?: string
  retryable?: boolean
  durationMs?: number
}

export interface LogEvent {
  ts: string
  level: LogLevel
  service: string
  audit?: boolean
  module?: string
  action?: string
  message: string
  requestId?: string
  providerRequestId?: string
  taskId?: string
  taskAttempt?: number
  threadId?: string
  turnId?: string
  operationId?: string
  projectId?: string
  userId?: string
  errorCode?: string
  retryable?: boolean
  durationMs?: number
  provider?: string
  details?: Record<string, unknown> | unknown[] | null
  error?: ErrorFields
}
