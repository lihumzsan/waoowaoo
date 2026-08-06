import {
  createFailureRecord,
  parseFailureRecord,
  type FailureRecord,
} from '../errors/failure'

export const TEMPORAL_FAILURE_PROTOCOL = 'wao.failure.v2' as const

type TemporalFailureEnvelope = {
  readonly protocol: typeof TEMPORAL_FAILURE_PROTOCOL
  readonly failure: FailureRecord
}

export function encodeTemporalFailure(failure: FailureRecord): {
  readonly type: typeof TEMPORAL_FAILURE_PROTOCOL
  readonly message: string
  readonly details: readonly [TemporalFailureEnvelope]
} {
  return {
    type: TEMPORAL_FAILURE_PROTOCOL,
    message: failure.native.message,
    details: [{ protocol: TEMPORAL_FAILURE_PROTOCOL, failure }],
  }
}

export function temporalInvariantFailure(
  reasonCode: string,
  details: readonly unknown[] = [],
): FailureRecord {
  return createFailureRecord('INTERNAL_ERROR', reasonCode, {
    context: { system: 'temporal', phase: 'protocol' },
    details: {
      reasonCode,
      ...(details.length > 0 ? { protocolDetails: [...details] } : {}),
    },
  })
}

function readEnvelope(value: unknown): FailureRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.protocol !== TEMPORAL_FAILURE_PROTOCOL) return null
  return parseFailureRecord(record.failure)
}

/** Restore the innermost canonical failure from Temporal SDK wrapper errors. */
export function decodeTemporalFailure(error: unknown): FailureRecord | null {
  let current: unknown = error
  const seen = new Set<unknown>()
  for (let depth = 0; depth < 12; depth += 1) {
    if (!current || typeof current !== 'object' || seen.has(current)) return null
    seen.add(current)
    const record = current as Record<string, unknown>
    if (record.type === TEMPORAL_FAILURE_PROTOCOL && Array.isArray(record.details)) {
      const failure = readEnvelope(record.details[0])
      if (failure) return failure
    }
    current = record.cause
  }
  return null
}
