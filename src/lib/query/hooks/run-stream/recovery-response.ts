import type { RecoverableRunRecord } from '@/lib/run-runtime/recovery'

type RunResponseRow = {
  id?: unknown
  status?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  leaseExpiresAt?: unknown
  heartbeatAt?: unknown
}

function readRequiredString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Invalid active runs response')
  }
  return value
}

function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    throw new Error('Invalid active runs response')
  }
  return value
}

export function parseRecoverableRuns(data: unknown): RecoverableRunRecord[] {
  if (
    !data
    || typeof data !== 'object'
    || !Array.isArray((data as { runs?: unknown }).runs)
  ) {
    throw new Error('Invalid active runs response')
  }

  return (data as { runs: unknown[] }).runs.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid active runs response')
    }
    const run = value as RunResponseRow
    return {
      id: readRequiredString(run.id),
      status: readRequiredString(run.status),
      createdAt: readRequiredString(run.createdAt),
      updatedAt: readRequiredString(run.updatedAt),
      leaseExpiresAt: readNullableString(run.leaseExpiresAt),
      heartbeatAt: readNullableString(run.heartbeatAt),
    }
  })
}
