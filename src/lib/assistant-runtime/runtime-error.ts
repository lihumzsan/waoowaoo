import type { RuntimeJsonObject, RuntimeJsonValue } from '@/lib/codex-runtime/runtime-adapter'
import type { UnifiedErrorCode } from '@/lib/errors/codes'

export type AssistantRuntimeFailure = {
  readonly errorCode: UnifiedErrorCode
  readonly errorMessage: string | null
}

const MAX_ERROR_MESSAGE_LENGTH = 2_000

function isRecord(value: RuntimeJsonValue | undefined): value is RuntimeJsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: RuntimeJsonObject): string | null {
  const message = error.message
  if (typeof message !== 'string' || !message.trim()) return null
  return message.trim().slice(0, MAX_ERROR_MESSAGE_LENGTH)
}

function codexErrorCode(info: RuntimeJsonValue | undefined): UnifiedErrorCode {
  if (typeof info === 'string') {
    switch (info) {
      case 'contextWindowExceeded':
      case 'sessionBudgetExceeded':
        return 'CONTEXT_BUDGET_EXCEEDED'
      case 'usageLimitExceeded':
        return 'QUOTA_EXCEEDED'
      case 'serverOverloaded':
      case 'internalServerError':
        return 'EXTERNAL_ERROR'
      case 'cyberPolicy':
        return 'SENSITIVE_CONTENT'
      case 'unauthorized':
        return 'PROVIDER_AUTH_INVALID'
      case 'badRequest':
        return 'ASSISTANT_PROVIDER_REQUEST_INVALID'
      case 'threadRollbackFailed':
      case 'sandboxError':
      case 'other':
      default:
        return 'PROJECT_AGENT_RUNTIME_FAILED'
    }
  }
  if (isRecord(info)) {
    if (
      isRecord(info.httpConnectionFailed)
      || isRecord(info.responseStreamConnectionFailed)
      || isRecord(info.responseStreamDisconnected)
      || isRecord(info.responseTooManyFailedAttempts)
    ) {
      return 'NETWORK_ERROR'
    }
    if (isRecord(info.activeTurnNotSteerable)) return 'AGENT_THREAD_BUSY'
  }
  return 'PROJECT_AGENT_RUNTIME_FAILED'
}

/** Parse the pinned Codex v2 TurnError protocol without reading logs or text UI. */
export function normalizeAssistantRuntimeFailure(
  value: RuntimeJsonValue | undefined,
): AssistantRuntimeFailure | null {
  if (!isRecord(value)) return null
  return {
    errorCode: codexErrorCode(value.codexErrorInfo),
    errorMessage: errorMessage(value),
  }
}

export function assistantRuntimeFailureForStopReason(
  stopReason: string,
): AssistantRuntimeFailure {
  if (stopReason === 'runtime_protocol_error') {
    return { errorCode: 'ASSISTANT_RUNTIME_PROTOCOL_ERROR', errorMessage: null }
  }
  if (stopReason.includes('persistence')) {
    return { errorCode: 'INTERNAL_ERROR', errorMessage: null }
  }
  return { errorCode: 'PROJECT_AGENT_RUNTIME_FAILED', errorMessage: null }
}
