import {
  getErrorSpec,
  resolveUnifiedErrorCode,
  type UnifiedErrorCode,
} from './codes'

export const FAILURE_RECORD_VERSION = 1 as const

export type FailureOrigin = {
  readonly system: 'application' | 'provider' | 'runtime' | 'temporal'
  readonly provider?: string
  readonly phase?: string
}

export type FailureDetails = Record<string, unknown> | null

/**
 * The single serializable failure fact shared by runtime exceptions,
 * checkpoints, Temporal payloads and persistent lifecycle owners.
 * `message` is internal diagnostic text; public copy is projected from the
 * stable code and allow-listed details at the product boundary.
 */
export type FailureRecord = {
  readonly version: typeof FAILURE_RECORD_VERSION
  readonly code: UnifiedErrorCode
  readonly message: string
  readonly details: FailureDetails
  readonly origin: FailureOrigin
}

function serializableDetails(value: FailureDetails | undefined): FailureDetails {
  if (value == null) return null
  try {
    const serialized = JSON.stringify(value)
    if (!serialized) return null
    const parsed: unknown = JSON.parse(serialized)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return { diagnostic: 'Failure details were not JSON-serializable' }
  }
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized.slice(0, maxLength) : null
}

function parseOrigin(value: unknown): FailureOrigin | null {
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
  return {
    system,
    ...(provider ? { provider } : {}),
    ...(phase ? { phase } : {}),
  }
}

export function createFailureRecord(
  code: UnifiedErrorCode,
  message?: string | null,
  options?: {
    readonly details?: FailureDetails
    readonly origin?: FailureOrigin
  },
): FailureRecord {
  const diagnostic = boundedString(message, 4_000)
  return {
    version: FAILURE_RECORD_VERSION,
    code,
    message: diagnostic ?? getErrorSpec(code).defaultMessage,
    details: serializableDetails(options?.details),
    origin: options?.origin ?? { system: 'application' },
  }
}

export function parseFailureRecord(value: unknown): FailureRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.version !== FAILURE_RECORD_VERSION) return null
  const code = resolveUnifiedErrorCode(record.code)
  const message = boundedString(record.message, 4_000)
  const origin = parseOrigin(record.origin)
  if (!code || !message || !origin) return null
  const details = record.details === null
    ? null
    : record.details && typeof record.details === 'object' && !Array.isArray(record.details)
      ? record.details as Record<string, unknown>
      : null
  if (record.details !== null && details === null) return null
  return {
    version: FAILURE_RECORD_VERSION,
    code,
    message,
    details,
    origin,
  }
}

export function projectProviderCredentialOwnership(
  failure: FailureRecord,
  credentialMode: 'platform-key' | 'user-key',
): FailureRecord {
  if (credentialMode !== 'platform-key') return failure
  const code = failure.code === 'PROVIDER_AUTH_INVALID'
    ? 'PLATFORM_PROVIDER_AUTH_INVALID'
    : failure.code === 'PROVIDER_BILLING_REQUIRED'
      ? 'PLATFORM_PROVIDER_BILLING_REQUIRED'
      : failure.code === 'EXTERNAL_ERROR'
        ? 'PLATFORM_PROVIDER_UNAVAILABLE'
        : failure.code
  return code === failure.code ? failure : { ...failure, code }
}
