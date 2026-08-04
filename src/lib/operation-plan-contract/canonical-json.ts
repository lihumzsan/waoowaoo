import { createHash } from 'node:crypto'

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => [key, canonicalize(record[key])]),
  )
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function hashCanonicalJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}
