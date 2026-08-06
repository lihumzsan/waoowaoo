import type { RuntimeJsonObject, RuntimeJsonValue } from '@/lib/codex-runtime/runtime-adapter'
import {
  getDeploymentConfig,
  type ProviderCredentialMode,
} from '@/lib/deployment/config'
import type { UnifiedErrorCode } from '@/lib/errors/codes'
import {
  createFailureRecord,
  projectProviderCredentialOwnership,
  type FailureRecord,
} from '@/lib/errors/failure'
import { normalizeAnyError } from '@/lib/errors/normalize'

export type AssistantRuntimeFailure = FailureRecord

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

function codexProviderHttpErrorCode(status: number): UnifiedErrorCode {
  if (status === 401 || status === 403) return 'PROVIDER_AUTH_INVALID'
  if (status === 402) return 'PROVIDER_BILLING_REQUIRED'
  return normalizeAnyError(
    { status },
    { fallbackCode: 'PROJECT_AGENT_RUNTIME_FAILED' },
  ).interpretation.code
}

function codexErrorCode(
  info: RuntimeJsonValue | undefined,
): UnifiedErrorCode {
  if (typeof info === 'string') {
    switch (info) {
      case 'contextWindowExceeded':
      case 'sessionBudgetExceeded':
        return 'CONTEXT_BUDGET_EXCEEDED'
      case 'usageLimitExceeded':
        return 'PROVIDER_BILLING_REQUIRED'
      case 'serverOverloaded':
        return 'EXTERNAL_ERROR'
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
      return codexProviderHttpErrorCode(httpStatus)
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
  const failure = createFailureRecord(
    codexErrorCode(value.codexErrorInfo),
    errorMessage(value),
    {
      cause: value,
      context: { system: 'runtime', provider: 'codex', phase: 'turn' },
    },
  )
  return projectProviderCredentialOwnership(
    failure,
    options?.providerCredentialMode ?? getDeploymentConfig().providerCredentialMode,
  )
}

export function assistantRuntimeFailureForStopReason(
  stopReason: string,
): AssistantRuntimeFailure {
  if (stopReason === 'runtime_protocol_error') {
    return createFailureRecord('ASSISTANT_RUNTIME_PROTOCOL_ERROR', null, {
      context: { system: 'runtime', phase: 'turn' },
    })
  }
  if (stopReason.includes('persistence')) {
    return createFailureRecord('INTERNAL_ERROR', null, {
      context: { system: 'runtime', phase: 'persistence' },
    })
  }
  return createFailureRecord('PROJECT_AGENT_RUNTIME_FAILED', null, {
    context: { system: 'runtime', phase: 'turn' },
  })
}
