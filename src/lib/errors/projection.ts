import {
  ERROR_CATEGORY,
  getErrorSpec,
  resolveUnifiedErrorCode,
  type UnifiedErrorCode,
} from './codes'
import type { FailureRecord, NativeFailureEvidence } from './failure'

export type UserErrorAction =
  | 'contact_support'
  | 'new_conversation'
  | 'open_provider_settings'
  | 'recharge'
  | 'relogin'
  | 'retry'
  | 'revise_input'
  | null

export type ModelErrorAction =
  | 'ask_user'
  | 'inform_user'
  | 'revise_input'
  | 'stop'
  | 'wait'

export interface UserErrorProjection {
  code: UnifiedErrorCode
  messageKey: string
  action: UserErrorAction
  retryable: boolean
  requestId: string | null
}

export interface ModelErrorProjection {
  code: UnifiedErrorCode
  category: string
  retryable: boolean
  action: ModelErrorAction
  details: Record<string, unknown>
}

function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s]*/gi, '$1?[redacted]')
    .replace(/([?&](?:token|signature|credential|key|secret)=)[^&\s]*/gi, '$1[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]')
    .replace(/\b(api[-_]?key|password|secret|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 2_000)
}

function projectNativeFailureEvidence(
  native: NativeFailureEvidence,
): Record<string, unknown> {
  return {
    name: native.name,
    message: sanitizeDiagnosticText(native.message),
    code: native.code,
    statusCode: native.statusCode,
    requestId: native.requestId,
    metadata: native.metadata,
    cause: native.cause ? projectNativeFailureEvidence(native.cause) : null,
  }
}

const PUBLIC_DETAIL_KEYS = new Set([
  'allowedTypes',
  'available',
  'code',
  'field',
  'inputMode',
  'limit',
  'maxBytes',
  'maxChars',
  'maxFiles',
  'mediaType',
  'required',
  'reasonCode',
  'retryAfter',
  'retryAfterSeconds',
  'workspacePath',
  'value',
])

function isPublicDetailValue(value: unknown): boolean {
  if (value === null) return true
  if (typeof value === 'string') return value.length <= 256
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'boolean') return true
  return Array.isArray(value)
    && value.length <= 20
    && value.every((item) => typeof item === 'string' && item.length <= 80)
}

export function projectPublicErrorDetails(
  details: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!details) return {}
  const projected: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(details)) {
    if (key === 'code' && !resolveUnifiedErrorCode(value)) continue
    if (PUBLIC_DETAIL_KEYS.has(key) && isPublicDetailValue(value)) {
      projected[key] = value
    }
  }
  return projected
}

const MODEL_CORRECTION_ACTIONS = new Set([
  'add_required_field',
  'fix_invalid_value',
  'move_unknown_field',
  'remove_unknown_field',
])

function projectModelCorrection(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  if (typeof source.action !== 'string' || !MODEL_CORRECTION_ACTIONS.has(source.action)) return null
  if (typeof source.fieldPath !== 'string' || source.fieldPath.length > 256) return null
  const projected: Record<string, unknown> = {
    action: source.action,
    fieldPath: source.fieldPath,
  }
  if (typeof source.message === 'string' && source.message.length <= 512) {
    projected.message = source.message
  }
  if (typeof source.targetPath === 'string' && source.targetPath.length <= 256) {
    projected.targetPath = source.targetPath
  }
  if (typeof source.issueCode === 'string' && source.issueCode.length <= 64) {
    projected.issueCode = source.issueCode
  }
  if (typeof source.reason === 'string' && source.reason.length <= 512) {
    projected.reason = source.reason
  }
  if (
    Array.isArray(source.allowedKeys)
    && source.allowedKeys.length <= 50
    && source.allowedKeys.every((key) => typeof key === 'string' && key.length <= 128)
  ) {
    projected.allowedKeys = source.allowedKeys
  }
  if (
    Array.isArray(source.allowedValues)
    && source.allowedValues.length <= 20
    && source.allowedValues.every((item) => (
      item === null
      || typeof item === 'string' && item.length <= 128
      || typeof item === 'number' && Number.isFinite(item)
      || typeof item === 'boolean'
    ))
  ) {
    projected.allowedValues = source.allowedValues
  }
  return projected
}

export function projectModelErrorDetails(
  details: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const projected = projectPublicErrorDetails(details)
  if (!Array.isArray(details?.corrections)) return projected
  const corrections = details.corrections
    .slice(0, 20)
    .map(projectModelCorrection)
    .filter((value): value is Record<string, unknown> => value !== null)
  return corrections.length > 0 ? { ...projected, corrections } : projected
}

function resolveUserAction(code: UnifiedErrorCode): UserErrorAction {
  if (code === 'UNAUTHORIZED') return 'relogin'
  if (code === 'INSUFFICIENT_BALANCE') return 'recharge'
  if (
    code === 'MODEL_NOT_CONFIGURED'
    || code === 'MODEL_NOT_OPEN'
    || code === 'MODEL_NOT_REGISTERED'
    || code === 'PROJECT_AGENT_ASSISTANT_MODEL_INVALID'
    || code === 'PROJECT_AGENT_ASSISTANT_MODEL_NOT_CONFIGURED'
    || code === 'MISSING_CONFIG'
    || code === 'PROVIDER_AUTH_INVALID'
    || code === 'PROVIDER_BILLING_REQUIRED'
  ) return 'open_provider_settings'
  if (code === 'CONTEXT_BUDGET_EXCEEDED') return 'new_conversation'
  const spec = getErrorSpec(code)
  if (
    spec.category === ERROR_CATEGORY.VALIDATION
    && (spec.httpStatus === 400 || spec.httpStatus === 413 || spec.httpStatus === 415 || spec.httpStatus === 422)
  ) return 'revise_input'
  if (code === 'SENSITIVE_CONTENT') return 'revise_input'
  if (code === 'AGENT_THREAD_BUSY' || code === 'PROJECT_AGENT_RUN_ACTIVE') return 'retry'
  if (spec.retryable) return 'retry'
  if (spec.category === ERROR_CATEGORY.SYSTEM) return 'contact_support'
  return null
}

function resolveModelAction(
  code: UnifiedErrorCode,
  taskReplay: FailureRecord['recovery']['taskReplay'],
): ModelErrorAction {
  if (
    code === 'TASK_NOT_READY'
    || code === 'PLATFORM_PROVIDER_AUTH_INVALID'
    || code === 'PLATFORM_PROVIDER_BILLING_REQUIRED'
    || code === 'PLATFORM_PROVIDER_UNAVAILABLE'
  ) return 'wait'
  if (
    code === 'INSUFFICIENT_BALANCE'
    || code === 'MODEL_NOT_CONFIGURED'
    || code === 'MODEL_NOT_OPEN'
    || code === 'MODEL_NOT_REGISTERED'
    || code === 'PROJECT_AGENT_ASSISTANT_MODEL_INVALID'
    || code === 'PROJECT_AGENT_ASSISTANT_MODEL_NOT_CONFIGURED'
    || code === 'PROVIDER_AUTH_INVALID'
    || code === 'PROVIDER_BILLING_REQUIRED'
    || code === 'UNAUTHORIZED'
  ) return 'ask_user'
  if (code === 'AGENT_THREAD_BUSY' || code === 'PROJECT_AGENT_RUN_ACTIVE') return 'wait'
  const spec = getErrorSpec(code)
  if (
    spec.category === ERROR_CATEGORY.CONTENT
    || spec.category === ERROR_CATEGORY.VALIDATION
  ) return 'revise_input'
  // A terminal Task failure never authorizes a new paid Operation. Retryable
  // is exposed as a fact, while the model is instructed to inform the user.
  if (taskReplay === 'safe') return 'inform_user'
  return 'stop'
}

export function projectErrorForUser(
  codeInput: unknown,
  requestId: string | null = null,
): UserErrorProjection {
  const code = resolveUnifiedErrorCode(codeInput) ?? 'INTERNAL_ERROR'
  const spec = getErrorSpec(code)
  return {
    code,
    messageKey: spec.userMessageKey,
    action: resolveUserAction(code),
    retryable: spec.retryable,
    requestId,
  }
}

export function projectErrorForModel(
  failure: FailureRecord | null | undefined,
): ModelErrorProjection {
  const code = failure?.interpretation.code ?? 'INTERNAL_ERROR'
  const spec = getErrorSpec(code)
  const taskReplay = failure?.recovery.taskReplay ?? 'forbidden'
  const productDetails = projectModelErrorDetails(failure?.interpretation.details)
  return {
    code,
    category: spec.category,
    retryable: taskReplay === 'safe',
    action: resolveModelAction(code, taskReplay),
    details: failure
      ? {
          ...productDetails,
          native: projectNativeFailureEvidence(failure.native),
          context: {
            system: failure.context.system,
            provider: failure.context.provider ?? null,
            phase: failure.context.phase ?? null,
            operation: failure.recovery.operation,
            frames: failure.frames.map((frame) => ({
              system: frame.system,
              provider: frame.provider ?? null,
              phase: frame.phase ?? null,
              operation: frame.operation ?? null,
              ...(frame.message ? { message: sanitizeDiagnosticText(frame.message) } : {}),
            })),
          },
          recovery: {
            effect: failure.recovery.effect,
            taskReplay: failure.recovery.taskReplay,
            attempts: failure.recovery.attempts,
          },
        }
      : productDetails,
  }
}
