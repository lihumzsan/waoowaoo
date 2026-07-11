import { describe, expect, it } from 'vitest'
import {
  getWorkerConcurrency,
  getWorkerExternalPollMs,
  getWorkerExternalTimeoutMs,
  getTaskReconcilerRuntimeConfig,
  getOutboxRuntimeConfig,
  resolvePositiveIntegerConfig,
} from '@/lib/workers/runtime-config'

describe('worker runtime config', () => {
  it('uses declared defaults only when variables are absent', () => {
    expect(getWorkerConcurrency('image', {})).toBe(20)
    expect(getWorkerConcurrency('outbox', {})).toBe(10)
    expect(getWorkerExternalTimeoutMs({})).toBe(1_200_000)
    expect(getWorkerExternalPollMs({})).toBe(3_000)
    expect(getTaskReconcilerRuntimeConfig({})).toEqual({
      intervalMs: 60_000,
      processingTimeoutMs: 300_000,
      terminalGraceMs: 90_000,
      missingGraceMs: 30_000,
    })
    expect(getOutboxRuntimeConfig({})).toEqual({
      dispatchIntervalMs: 5_000,
      staleEnqueuedMs: 90_000,
      leaseMs: 900_000,
      maxDeliveryAttempts: 5,
    })
  })

  it('rejects unsafe reconciler and outbox timing values', () => {
    expect(() => getTaskReconcilerRuntimeConfig({
      TASK_RECONCILE_INTERVAL_MS: '999',
    })).toThrow('POSITIVE_INTEGER_CONFIG_INVALID:TASK_RECONCILE_INTERVAL_MS:999')
    expect(() => getOutboxRuntimeConfig({
      OUTBOX_LEASE_MS: '2999',
    })).toThrow('POSITIVE_INTEGER_CONFIG_INVALID:OUTBOX_LEASE_MS:2999')
    expect(() => getOutboxRuntimeConfig({
      OUTBOX_MAX_DELIVERY_ATTEMPTS: '101',
    })).toThrow('POSITIVE_INTEGER_CONFIG_INVALID:OUTBOX_MAX_DELIVERY_ATTEMPTS:101')
  })

  it('parses explicit positive integers', () => {
    expect(getWorkerConcurrency('video', { QUEUE_CONCURRENCY_VIDEO: '12' })).toBe(12)
    expect(resolvePositiveIntegerConfig({
      name: 'TEST_INTEGER',
      value: '9000',
      defaultValue: 1,
    })).toBe(9_000)
  })

  it.each(['', '0', '-1', '1.5', 'abc', '9007199254740992'])(
    'fails explicitly for configured invalid value %s',
    (value) => {
      expect(() => resolvePositiveIntegerConfig({
        name: 'TEST_INTEGER',
        value,
        defaultValue: 1,
      })).toThrow(`POSITIVE_INTEGER_CONFIG_INVALID:TEST_INTEGER:${value}`)
    },
  )
})
