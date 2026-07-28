import { createHash } from 'node:crypto'

type UnknownRecord = Record<string, unknown>

function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value.trim())
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => item === undefined ? 'null' : stableStringify(item)).join(',')}]`
  const record = value as UnknownRecord
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
  return `{${entries.join(',')}}`
}

/** Stable approval-input identity; it is not an operation lifecycle signal. */
export function stableArgsFingerprint(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex')
}

/** Compact identity for database and idempotency keys. */
export function stableArgsHash(input: unknown): string {
  return stableArgsFingerprint(input).slice(0, 16)
}
