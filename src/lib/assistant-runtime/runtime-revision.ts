import { createHash } from 'node:crypto'

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('ASSISTANT_RUNTIME_CONTRACT_NUMBER_INVALID')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value !== 'object') throw new Error('ASSISTANT_RUNTIME_CONTRACT_VALUE_INVALID')
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`
}

function addFramed(hash: ReturnType<typeof createHash>, value: string): void {
  const bytes = Buffer.from(value, 'utf8')
  const length = Buffer.allocUnsafe(4)
  length.writeUInt32BE(bytes.length)
  hash.update(length)
  hash.update(bytes)
}

/**
 * Derive the one compatibility identity used by both durable Codex state and
 * the product Thread. The identity changes with the actual resumable contract,
 * so a tool or instruction cutover cannot accidentally reuse a stale Thread.
 */
export function deriveAssistantRuntimeRevision(input: {
  readonly codexVersion: string
  readonly developerInstructions: string
  readonly staticContract: unknown
}): string {
  const version = input.codexVersion.trim()
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error('ASSISTANT_RUNTIME_CODEX_VERSION_INVALID')
  }
  if (!input.developerInstructions.trim()) {
    throw new Error('ASSISTANT_RUNTIME_DEVELOPER_INSTRUCTIONS_REQUIRED')
  }
  const hash = createHash('sha256')
  addFramed(hash, version)
  addFramed(hash, input.developerInstructions)
  addFramed(hash, canonicalJson(input.staticContract))
  return `codex-${version}-contract-${hash.digest('hex').slice(0, 24)}`
}
