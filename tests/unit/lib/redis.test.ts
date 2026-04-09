import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const redisConstructorMock = vi.hoisted(() => vi.fn())
const redisClientFactoryMock = vi.hoisted(() => vi.fn(() => ({
  on: vi.fn(),
})))

vi.mock('ioredis', () => ({
  default: redisConstructorMock.mockImplementation(redisClientFactoryMock),
}))

vi.mock('@/lib/logging/core', () => ({
  logDebug: vi.fn(),
  logError: vi.fn(),
}))

describe('redis subscriber config', () => {
  beforeEach(() => {
    vi.resetModules()
    redisConstructorMock.mockClear()
    redisClientFactoryMock.mockClear()
    delete (globalThis as typeof globalThis & { __waoowaooRedis?: unknown }).__waoowaooRedis
  })

  afterEach(() => {
    delete (globalThis as typeof globalThis & { __waoowaooRedis?: unknown }).__waoowaooRedis
  })

  it('creates subscriber clients with ready check disabled', async () => {
    const redisModule = await import('@/lib/redis')

    expect(redisConstructorMock).toHaveBeenCalledTimes(2)

    redisModule.createSubscriber()

    expect(redisConstructorMock).toHaveBeenCalledTimes(3)

    const appOptions = redisConstructorMock.mock.calls[0]?.[0] as Record<string, unknown>
    const subscriberOptions = redisConstructorMock.mock.calls[2]?.[0] as Record<string, unknown>

    expect(appOptions.enableReadyCheck).toBe(true)
    expect(subscriberOptions.enableReadyCheck).toBe(false)
    expect(subscriberOptions.maxRetriesPerRequest).toBeNull()
  })
})
