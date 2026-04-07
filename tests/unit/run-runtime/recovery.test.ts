import { describe, expect, it } from 'vitest'
import { RUN_STATUS } from '@/lib/run-runtime/types'
import { isRecoverableRunRecord, selectRecoverableRun } from '@/lib/run-runtime/recovery'

describe('run recovery', () => {
  it('treats queued runs as recoverable', () => {
    expect(isRecoverableRunRecord({
      id: 'run-1',
      status: RUN_STATUS.QUEUED,
    })).toBe(true)
  })

  it('rejects running runs with expired lease and no heartbeat extension', () => {
    const now = Date.parse('2026-03-30T10:00:00.000Z')
    expect(isRecoverableRunRecord({
      id: 'run-1',
      status: RUN_STATUS.RUNNING,
      leaseExpiresAt: '2026-03-30T09:59:00.000Z',
      heartbeatAt: '2026-03-30T09:58:30.000Z',
    }, now)).toBe(false)
  })

  it('prefers the latest recoverable run and skips stale leased runs', () => {
    const now = Date.parse('2026-03-30T10:00:00.000Z')
    const decision = selectRecoverableRun([
      {
        id: 'run-stale',
        status: RUN_STATUS.RUNNING,
        createdAt: '2026-03-30T09:00:00.000Z',
        updatedAt: '2026-03-30T09:30:00.000Z',
        leaseExpiresAt: '2026-03-30T09:59:00.000Z',
        heartbeatAt: '2026-03-30T09:58:30.000Z',
      },
      {
        id: 'run-fresh',
        status: RUN_STATUS.RUNNING,
        createdAt: '2026-03-30T09:50:00.000Z',
        updatedAt: '2026-03-30T09:59:30.000Z',
        leaseExpiresAt: '2026-03-30T10:02:00.000Z',
        heartbeatAt: '2026-03-30T09:59:30.000Z',
      },
    ], now)

    expect(decision).toEqual({
      runId: 'run-fresh',
      reason: 'latest_active',
    })
  })

  it('skips a newer stale active run when an older recoverable run still exists', () => {
    const now = Date.parse('2026-03-30T10:00:00.000Z')
    const decision = selectRecoverableRun([
      {
        id: 'run-new-stale',
        status: RUN_STATUS.RUNNING,
        createdAt: '2026-03-30T09:58:00.000Z',
        updatedAt: '2026-03-30T09:59:50.000Z',
        leaseExpiresAt: '2026-03-30T09:59:00.000Z',
        heartbeatAt: '2026-03-30T09:58:30.000Z',
      },
      {
        id: 'run-older-fresh',
        status: RUN_STATUS.RUNNING,
        createdAt: '2026-03-30T09:50:00.000Z',
        updatedAt: '2026-03-30T09:59:30.000Z',
        leaseExpiresAt: '2026-03-30T10:02:00.000Z',
        heartbeatAt: '2026-03-30T09:59:30.000Z',
      },
    ], now)

    expect(decision).toEqual({
      runId: 'run-older-fresh',
      reason: 'latest_active',
    })
  })
})
