import {
  getExternalOperationContract,
  isExternalOperationId,
  type ExternalEffect,
  type ExternalOperationId,
  type TaskReplaySafety,
} from '../external-operation/registry'
import {
  getErrorSpec,
  resolveUnifiedErrorCode,
  type UnifiedErrorCode,
} from './codes'

export const FAILURE_RECORD_VERSION = 2 as const

export type FailureContext = {
  readonly system: 'application' | 'provider' | 'runtime' | 'temporal'
  readonly provider?: string
  readonly phase?: string
  readonly operation?: ExternalOperationId
}

export type FailureDetails = Record<string, unknown> | null

export type NativeFailureEvidence = {
  readonly name: string
  readonly message: string
  readonly code: string | null
  readonly statusCode: number | null
  readonly requestId: string | null
  readonly metadata: Record<string, unknown> | null
  readonly cause: NativeFailureEvidence | null
}

export type FailureInterpretation = {
  readonly code: UnifiedErrorCode
  readonly details: FailureDetails
}

export type FailureRecovery = {
  readonly operation: ExternalOperationId | null
  readonly effect: ExternalEffect
  readonly taskReplay: TaskReplaySafety
  readonly attempts: number
}

export type FailureFrame = FailureContext & {
  readonly message?: string
}

/**
 * The only serializable failure fact. Native evidence is mandatory and never
 * replaced by product interpretation. Context frames and interpretation may
 * be appended while the original throw remains intact.
 */
export type FailureRecord = {
  readonly version: typeof FAILURE_RECORD_VERSION
  readonly native: NativeFailureEvidence
  readonly interpretation: FailureInterpretation
  readonly context: FailureContext
  readonly recovery: FailureRecovery
  readonly frames: readonly FailureFrame[]
}

export function hasProviderFailureEvidence(failure: FailureRecord): boolean {
  return failure.context.system === 'provider'
    || failure.frames.some((frame) => frame.system === 'provider')
}

const SENSITIVE_KEY = /(?:authorization|cookie|secret|token|password|api[-_]?key|credential|signature)/i
const BUSINESS_CONTENT_KEY = /^\$?(?:audio|base64|body|data|image|input|output|prompt|request|response|url|video)s?$/i

function sanitizeText(value: string, maxLength: number): string {
  return value
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s]*/gi, '$1?[redacted]')
    .replace(/([?&](?:token|signature|credential|key|secret)=)[^&\s]*/gi, '$1[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]')
    .replace(/\b(api[-_]?key|password|secret|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, maxLength)
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized.slice(0, maxLength) : null
}

function readStatus(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d{3}$/.test(value.trim())
      ? Number.parseInt(value, 10)
      : Number.NaN
  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 599 ? parsed : null
}

function sanitizeValue(value: unknown, depth: number, seen: Set<unknown>): unknown {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'string') return sanitizeText(value, 2_000)
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (depth >= 4) return '[truncated]'
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1, seen))
  }
  if (!value || typeof value !== 'object') return String(value)
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  const projected: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value).slice(0, 40)) {
    if (key === 'stack' || key === 'cause' || key === 'failure') continue
    projected[key] = SENSITIVE_KEY.test(key) || BUSINESS_CONTENT_KEY.test(key)
      ? '[redacted]'
      : sanitizeValue(child, depth + 1, seen)
  }
  seen.delete(value)
  return projected
}

function serializableRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const sanitized = sanitizeValue(value, 0, new Set())
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) return null
  const serialized = JSON.stringify(sanitized)
  if (!serialized || serialized === '{}') return null
  if (serialized.length <= 16_000) return sanitized as Record<string, unknown>
  return { truncated: true, preview: serialized.slice(0, 15_900) }
}

function nativeCode(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return boundedString(value, 256)
}

function readRequestId(record: Record<string, unknown>): string | null {
  const metadata = record.$metadata && typeof record.$metadata === 'object'
    ? record.$metadata as Record<string, unknown>
    : null
  return boundedString(record.requestId, 256)
    ?? boundedString(record.request_id, 256)
    ?? boundedString(metadata?.requestId, 256)
    ?? boundedString(metadata?.request_id, 256)
}

function nativeEvidenceFrom(
  value: unknown,
  fallbackMessage: string,
  depth = 0,
  seen = new Set<unknown>(),
): NativeFailureEvidence {
  if (depth >= 8 || !value || typeof value !== 'object' || seen.has(value)) {
    return {
      name: value instanceof Error ? value.name || 'Error' : typeof value,
      message: sanitizeText(
        boundedString(fallbackMessage, 4_000) ?? String(value),
        4_000,
      ),
      code: null,
      statusCode: null,
      requestId: null,
      metadata: null,
      cause: null,
    }
  }
  seen.add(value)
  const record = value as Record<string, unknown>
  const metadata = record.$metadata && typeof record.$metadata === 'object'
    ? record.$metadata as Record<string, unknown>
    : null
  const message = sanitizeText(boundedString(record.message, 4_000)
    ?? boundedString(fallbackMessage, 4_000)
    ?? String(value), 4_000)
  const evidence: NativeFailureEvidence = {
    name: boundedString(record.name, 256)
      ?? (value instanceof Error ? value.name : null)
      ?? 'ThrownObject',
    message,
    code: nativeCode(record.code),
    statusCode: readStatus(record.statusCode)
      ?? readStatus(record.status)
      ?? readStatus(metadata?.httpStatusCode),
    requestId: readRequestId(record),
    metadata: serializableRecord(value),
    cause: record.cause === undefined
      ? null
      : nativeEvidenceFrom(record.cause, 'Caused by an unknown failure', depth + 1, seen),
  }
  seen.delete(value)
  return evidence
}

function serializableDetails(value: FailureDetails | undefined): FailureDetails {
  return serializableRecord(value)
}

function parseContext(value: unknown): FailureContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const system = record.system
  if (
    system !== 'application'
    && system !== 'provider'
    && system !== 'runtime'
    && system !== 'temporal'
  ) return null
  const provider = boundedString(record.provider, 128)
  const phase = boundedString(record.phase, 128)
  const operation = isExternalOperationId(record.operation) ? record.operation : null
  if (record.operation !== undefined && !operation) return null
  return {
    system,
    ...(provider ? { provider } : {}),
    ...(phase ? { phase } : {}),
    ...(operation ? { operation } : {}),
  }
}

function recoveryFor(operation: ExternalOperationId | null, attempts: number): FailureRecovery {
  if (!operation) {
    return { operation: null, effect: 'unknown', taskReplay: 'forbidden', attempts }
  }
  const contract = getExternalOperationContract(operation)
  return {
    operation,
    effect: contract.effectOnFailure,
    taskReplay: contract.taskReplay,
    attempts,
  }
}

export function createFailureRecord(
  code: UnifiedErrorCode,
  message?: string | null,
  options?: {
    readonly cause?: unknown
    readonly details?: FailureDetails
    readonly context?: FailureContext
    readonly operation?: ExternalOperationId
    readonly attempts?: number
  },
): FailureRecord {
  const diagnostic = boundedString(message, 4_000) ?? getErrorSpec(code).defaultMessage
  const context: FailureContext = options?.context ?? { system: 'application' }
  const operation = options?.operation ?? context.operation ?? null
  return {
    version: FAILURE_RECORD_VERSION,
    native: nativeEvidenceFrom(options?.cause ?? { name: 'AppError', message: diagnostic, code }, diagnostic),
    interpretation: {
      code,
      details: serializableDetails(options?.details),
    },
    context: {
      ...context,
      ...(operation ? { operation } : {}),
    },
    recovery: recoveryFor(operation, options?.attempts ?? 1),
    frames: [],
  }
}

export function augmentFailureRecord(
  failure: FailureRecord,
  options: {
    readonly code?: UnifiedErrorCode
    readonly details?: FailureDetails
    readonly context?: FailureContext
    readonly operation?: ExternalOperationId
    readonly attempts?: number
    readonly message?: string
  },
): FailureRecord {
  // The operation at the first failure boundary owns replay semantics. Outer
  // wrappers may add a frame, but must never turn a forbidden provider submit
  // into a safe Temporal/database operation. A boundary may assign an
  // operation only when the carried record did not have one yet.
  const operation = failure.recovery.operation
    ?? options.operation
    ?? options.context?.operation
    ?? null
  const boundaryOperation = options.operation ?? options.context?.operation ?? null
  const attempts = failure.recovery.operation !== null
    && boundaryOperation !== null
    && failure.recovery.operation !== boundaryOperation
    ? failure.recovery.attempts
    : options.attempts ?? failure.recovery.attempts
  const context = failure.context
  const existingDetails = failure.interpretation.details ?? {}
  const addedDetails = serializableDetails(options.details) ?? {}
  return {
    ...failure,
    interpretation: {
      code: options.code ?? failure.interpretation.code,
      details: Object.keys(existingDetails).length > 0 || Object.keys(addedDetails).length > 0
        ? { ...existingDetails, ...addedDetails }
        : null,
    },
    context,
    recovery: recoveryFor(operation, attempts),
    frames: options.context || options.message
      ? [
          ...failure.frames,
          {
            ...(options.context ?? context),
            ...(operation ? { operation } : {}),
            ...(options.message ? { message: options.message.slice(0, 1_000) } : {}),
          },
        ]
      : failure.frames,
  }
}

function parseNative(value: unknown, depth = 0): NativeFailureEvidence | null {
  if (depth >= 8 || !value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const name = boundedString(record.name, 256)
  const message = boundedString(record.message, 4_000)
  if (!name || !message) return null
  const code = record.code === null ? null : nativeCode(record.code)
  const statusCode = record.statusCode === null ? null : readStatus(record.statusCode)
  const requestId = record.requestId === null ? null : boundedString(record.requestId, 256)
  if (record.code !== null && code === null) return null
  if (record.statusCode !== null && statusCode === null) return null
  if (record.requestId !== null && requestId === null) return null
  const metadata = record.metadata === null ? null : serializableRecord(record.metadata)
  if (record.metadata !== null && metadata === null) return null
  const cause = record.cause === null ? null : parseNative(record.cause, depth + 1)
  if (record.cause !== null && cause === null) return null
  return { name, message, code, statusCode, requestId, metadata, cause }
}

export function parseFailureRecord(value: unknown): FailureRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.version !== FAILURE_RECORD_VERSION) return null
  const native = parseNative(record.native)
  const context = parseContext(record.context)
  if (!native || !context) return null
  if (!record.interpretation || typeof record.interpretation !== 'object' || Array.isArray(record.interpretation)) return null
  const interpretation = record.interpretation as Record<string, unknown>
  const code = resolveUnifiedErrorCode(interpretation.code)
  if (!code) return null
  const details = interpretation.details === null ? null : serializableRecord(interpretation.details)
  if (interpretation.details !== null && details === null) return null
  if (!record.recovery || typeof record.recovery !== 'object' || Array.isArray(record.recovery)) return null
  const recovery = record.recovery as Record<string, unknown>
  const operation = recovery.operation === null
    ? null
    : isExternalOperationId(recovery.operation)
      ? recovery.operation
      : undefined
  if (operation === undefined) return null
  if (
    recovery.effect !== 'committed'
    && recovery.effect !== 'none'
    && recovery.effect !== 'unknown'
  ) return null
  if (recovery.taskReplay !== 'safe' && recovery.taskReplay !== 'forbidden') return null
  if (!Number.isSafeInteger(recovery.attempts) || (recovery.attempts as number) < 1) return null
  const expectedRecovery = recoveryFor(operation, recovery.attempts as number)
  if (
    recovery.effect !== expectedRecovery.effect
    || recovery.taskReplay !== expectedRecovery.taskReplay
    || (operation !== null
      && (recovery.attempts as number) > getExternalOperationContract(operation).maxAttempts)
  ) return null
  if (!Array.isArray(record.frames)) return null
  const frames: FailureFrame[] = []
  for (const rawFrame of record.frames) {
    const frame = parseContext(rawFrame)
    if (!frame) return null
    const message = boundedString((rawFrame as Record<string, unknown>).message, 1_000)
    frames.push({ ...frame, ...(message ? { message } : {}) })
  }
  return {
    version: FAILURE_RECORD_VERSION,
    native,
    interpretation: { code, details },
    context,
    recovery: {
      operation,
      effect: recovery.effect,
      taskReplay: recovery.taskReplay,
      attempts: recovery.attempts as number,
    },
    frames,
  }
}

export function projectProviderCredentialOwnership(
  failure: FailureRecord,
  credentialMode: 'platform-key' | 'user-key',
): FailureRecord {
  if (credentialMode !== 'platform-key') return failure
  const current = failure.interpretation.code
  const code = current === 'PROVIDER_AUTH_INVALID'
    ? 'PLATFORM_PROVIDER_AUTH_INVALID'
    : current === 'PROVIDER_BILLING_REQUIRED'
      ? 'PLATFORM_PROVIDER_BILLING_REQUIRED'
      : current === 'EXTERNAL_ERROR'
        ? 'PLATFORM_PROVIDER_UNAVAILABLE'
        : current
  return code === current ? failure : augmentFailureRecord(failure, { code })
}
