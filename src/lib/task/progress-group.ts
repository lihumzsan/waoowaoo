function normalizeString(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function buildTaskProgressGroupId(input: {
  readonly operationId?: string | null
  readonly operationRequestId?: string | null
}): string | null {
  const operationId = normalizeString(input.operationId)
  const operationRequestId = normalizeString(input.operationRequestId)
  if (!operationId || !operationRequestId) return null
  return `operation:${operationId}:${operationRequestId}`
}

export function readTaskPayloadProgressGroupId(payload: unknown): string | null {
  const payloadObject = asObject(payload)
  const payloadUi = asObject(payloadObject?.ui)
  return typeof payloadUi?.progressGroupId === 'string'
    ? normalizeString(payloadUi.progressGroupId)
    : null
}

export function withTaskProgressGroupPayload(
  payload: Record<string, unknown>,
  progressGroupId: string | null,
): Record<string, unknown> {
  if (!progressGroupId) return payload
  const payloadUi = asObject(payload.ui) || {}
  return {
    ...payload,
    ui: {
      ...payloadUi,
      progressGroupId,
    },
  }
}
