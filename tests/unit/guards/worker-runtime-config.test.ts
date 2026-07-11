import { describe, expect, it } from 'vitest'
import { inspectWorkerRuntimeConfigContract } from '../../../scripts/guards/worker-runtime-config-guard.mjs'

const registry = `
  image: { env: 'IMAGE' }
  video: { env: 'VIDEO' }
  music: { env: 'MUSIC' }
  text: { env: 'TEXT' }
  outbox: { env: 'OUTBOX' }
  resolvePositiveIntegerConfig
  POSITIVE_INTEGER_CONFIG_INVALID
  getWorkerExternalTimeoutMs
  getWorkerExternalPollMs
  getTaskReconcilerRuntimeConfig
  getOutboxRuntimeConfig
  name: 'OUTBOX_MAX_DELIVERY_ATTEMPTS'
`
const workers = `
  getWorkerConcurrency('image')
  getWorkerConcurrency('video')
  getWorkerConcurrency('music')
  getWorkerConcurrency('text')
  getWorkerConcurrency('outbox')
  getTaskReconcilerRuntimeConfig()
  getOutboxRuntimeConfig()
  const currentAttempt = row.deliveryCount
`
const redis = 'resolveRedisRuntimeConfig()'
const redisConfig = 'resolvePositiveIntegerConfig maxValue: 65_535 BOOLEAN_CONFIG_INVALID:REDIS_TLS'

describe('worker runtime config guard', () => {
  it('accepts the exhaustive shared registry', () => {
    expect(inspectWorkerRuntimeConfigContract({
      runtimeConfig: registry,
      workers,
      redis,
      redisConfig,
    })).toEqual([])
  })

  it('rejects a distributed silent fallback', () => {
    expect(inspectWorkerRuntimeConfigContract({
      runtimeConfig: registry,
      workers: `${workers}\nNumber.parseInt(process.env.QUEUE_CONCURRENCY_IMAGE || '20', 10)`,
      redis,
      redisConfig,
    })).toContain('worker runtime config must not restore distributed parse/fallback logic')
  })
})
