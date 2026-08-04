export interface ParsedApiErrorPayload {
  code: string | null
  message: string | null
  details: Record<string, unknown> | null
  required: number | null
  available: number | null
  requestId: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseApiErrorPayload(payload: unknown): ParsedApiErrorPayload {
  const source = isRecord(payload) ? payload : {}
  const error = isRecord(source.error) ? source.error : {}
  const details = isRecord(error.details) ? error.details : null

  const code =
    readString(error.code) ||
    readString(source.code)

  const message =
    readString(error.message) ||
    readString(details?.message) ||
    readString(source.message) ||
    readString(source.error)

  return {
    code,
    message,
    details,
    required: readNumber(details?.required) ?? readNumber(source.required),
    available: readNumber(details?.available) ?? readNumber(source.available),
    requestId: readString(details?.requestId) || readString(source.requestId),
  }
}

export function isInsufficientBalanceApiError(payload: unknown, status?: number): boolean {
  const parsed = parseApiErrorPayload(payload)
  return status === 402 || parsed.code === 'INSUFFICIENT_BALANCE'
}
