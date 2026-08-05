import type { RuntimeJsonObject, RuntimeJsonValue } from '@/lib/codex-runtime/runtime-adapter'
import {
  getDeploymentConfig,
  type ProviderCredentialMode,
} from '@/lib/deployment/config'
import type { UnifiedErrorCode } from '@/lib/errors/codes'
import { normalizeAnyError } from '@/lib/errors/normalize'

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

function codexHttpStatusCode(info: RuntimeJsonObject): number | null {
  for (const key of [
    'httpConnectionFailed',
    'responseStreamConnectionFailed',
    'responseStreamDisconnected',
    'responseTooManyFailedAttempts',
  ] as const) {
    const detail = info[key]
    if (!isRecord(detail)) continue
    const status = detail.httpStatusCode
    if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
      return status
    }
  }
  return null
}

function projectProviderCredentialOwnership(
  code: UnifiedErrorCode,
  providerCredentialMode: ProviderCredentialMode,
): UnifiedErrorCode {
  if (providerCredentialMode !== 'platform-key') return code
  if (code === 'PROVIDER_AUTH_INVALID') return 'PLATFORM_PROVIDER_AUTH_INVALID'
  if (code === 'PROVIDER_BILLING_REQUIRED') return 'PLATFORM_PROVIDER_BILLING_REQUIRED'
  return code
}

function codexErrorCode(
  info: RuntimeJsonValue | undefined,
  providerCredentialMode: ProviderCredentialMode,
): UnifiedErrorCode {
  if (typeof info === 'string') {
    switch (info) {
      case 'contextWindowExceeded':
      case 'sessionBudgetExceeded':
        return 'CONTEXT_BUDGET_EXCEEDED'
      case 'usageLimitExceeded':
        return projectProviderCredentialOwnership(
          'PROVIDER_BILLING_REQUIRED',
          providerCredentialMode,
        )
      case 'serverOverloaded':
        return providerCredentialMode === 'platform-key'
          ? 'PLATFORM_PROVIDER_UNAVAILABLE'
          : 'EXTERNAL_ERROR'
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
    const httpStatus = codexHttpStatusCode(info)
    if (httpStatus !== null) {
      return projectProviderCredentialOwnership(normalizeAnyError(
        { status: httpStatus },
        { context: 'worker', fallbackCode: 'PROJECT_AGENT_RUNTIME_FAILED' },
      ).code, providerCredentialMode)
    }
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
  options?: { readonly providerCredentialMode?: ProviderCredentialMode },
): AssistantRuntimeFailure | null {
  if (!isRecord(value)) return null
  return {
    errorCode: codexErrorCode(
      value.codexErrorInfo,
      options?.providerCredentialMode ?? getDeploymentConfig().providerCredentialMode,
    ),
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
