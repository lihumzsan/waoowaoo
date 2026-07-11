import { describe, expect, it } from 'vitest'
import { resolveRedisRuntimeConfig } from '@/lib/redis-config'

describe('Redis runtime config', () => {
  it('uses explicit documented defaults only for absent values', () => {
    expect(resolveRedisRuntimeConfig({})).toEqual({
      host: '127.0.0.1',
      port: 6_379,
      username: undefined,
      password: undefined,
      tls: false,
    })
  })

  it('parses an explicit Redis endpoint and empty optional credentials', () => {
    expect(resolveRedisRuntimeConfig({
      REDIS_HOST: 'redis.internal',
      REDIS_PORT: '16379',
      REDIS_USERNAME: '',
      REDIS_PASSWORD: '',
      REDIS_TLS: 'true',
    })).toEqual({
      host: 'redis.internal',
      port: 16_379,
      username: undefined,
      password: undefined,
      tls: true,
    })
  })

  it('preserves configured credential bytes instead of trimming secrets', () => {
    expect(resolveRedisRuntimeConfig({ REDIS_PASSWORD: ' secret ' }).password).toBe(' secret ')
  })

  it.each([
    [{ REDIS_HOST: '' }, 'TEXT_CONFIG_INVALID:REDIS_HOST'],
    [{ REDIS_PORT: '0' }, 'POSITIVE_INTEGER_CONFIG_INVALID:REDIS_PORT:0'],
    [{ REDIS_PORT: '65536' }, 'POSITIVE_INTEGER_CONFIG_INVALID:REDIS_PORT:65536'],
    [{ REDIS_TLS: 'yes' }, 'BOOLEAN_CONFIG_INVALID:REDIS_TLS:yes'],
  ] as const)('fails explicitly for invalid Redis config %#', (env, error) => {
    expect(() => resolveRedisRuntimeConfig(env)).toThrow(error)
  })
})
