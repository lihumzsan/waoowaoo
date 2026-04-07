import { RUN_STATUS, type RunStatus } from './types'

export type RecoverableRunRecord = {
  id?: string | null
  status?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  leaseExpiresAt?: string | null
  heartbeatAt?: string | null
}

export type RunRecoveryDecision = {
  runId: string | null
  reason: 'latest_active' | 'expired_lease' | 'terminal' | 'missing'
}

const ACTIVE_RUN_STATUSES = new Set<RunStatus>([
  RUN_STATUS.QUEUED,
  RUN_STATUS.RUNNING,
  RUN_STATUS.CANCELING,
])

function toTimestamp(value: string | null | undefined): number {
  if (!value) return 0
  const ts = Date.parse(value)
  return Number.isFinite(ts) ? ts : 0
}

export function isRecoverableRunRecord(run: RecoverableRunRecord, now = Date.now()) {
  const status = typeof run.status === 'string' ? run.status : ''
  if (!ACTIVE_RUN_STATUSES.has(status as RunStatus)) {
    return false
  }
  if (status === RUN_STATUS.QUEUED) {
    return true
  }

  const leaseExpiresAt = toTimestamp(run.leaseExpiresAt)
  if (!leaseExpiresAt) {
    return true
  }
  if (leaseExpiresAt >= now) {
    return true
  }

  const heartbeatAt = toTimestamp(run.heartbeatAt)
  return heartbeatAt > leaseExpiresAt
}

export function selectRecoverableRun(runs: RecoverableRunRecord[], now = Date.now()): RunRecoveryDecision {
  if (!Array.isArray(runs) || runs.length === 0) {
    return {
      runId: null,
      reason: 'missing',
    }
  }

  const orderedRuns = [...runs].sort((left, right) => {
    const updatedDelta = toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt)
    if (updatedDelta !== 0) return updatedDelta
    return toTimestamp(right.createdAt) - toTimestamp(left.createdAt)
  })

  let sawExpiredLease = false
  for (const run of orderedRuns) {
    const runId = typeof run.id === 'string' ? run.id.trim() : ''
    if (!runId) continue
    const status = typeof run.status === 'string' ? run.status : ''
    if (!ACTIVE_RUN_STATUSES.has(status as RunStatus)) {
      continue
    }
    if (isRecoverableRunRecord(run, now)) {
      return {
        runId,
        reason: 'latest_active',
      }
    }
    sawExpiredLease = true
  }

  return {
    runId: null,
    reason: sawExpiredLease ? 'expired_lease' : 'terminal',
  }
}
