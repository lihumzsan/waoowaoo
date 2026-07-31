import { logDebug as _ulogDebug, logError as _ulogError } from '@/lib/logging/core'
import Redis from 'ioredis'
import { resolveRedisRuntimeConfig } from './redis-config'

type RedisSingleton = {
  app?: Redis
}

const globalForRedis = globalThis as typeof globalThis & {
  __waoowaooRedis?: RedisSingleton
}

const redisConfig = resolveRedisRuntimeConfig()
function buildBaseConfig() {
  return {
    host: redisConfig.host,
    port: redisConfig.port,
    username: redisConfig.username,
    password: redisConfig.password,
    tls: redisConfig.tls ? {} : undefined,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy(times: number) {
      // Exponential backoff capped at 30s.
      return Math.min(2 ** Math.min(times, 10) * 100, 30_000)
    },
  }
}

function onConnectLog(scope: string, client: Redis) {
  client.on('connect', () => _ulogDebug(`[Redis:${scope}] connected ${redisConfig.host}:${redisConfig.port}`))
  client.on('error', (err) => _ulogError(`[Redis:${scope}] error:`, err.message))
}

function createAppRedis() {
  const client = new Redis({
    ...buildBaseConfig(),
    maxRetriesPerRequest: 2,
  })
  onConnectLog('app', client)
  return client
}

const singleton = globalForRedis.__waoowaooRedis || {}
if (!globalForRedis.__waoowaooRedis) {
  globalForRedis.__waoowaooRedis = singleton
}

function getAppRedis() {
  return singleton.app || (singleton.app = createAppRedis())
}

function createLazyRedisProxy(getClient: () => Redis) {
  return new Proxy({} as Redis, {
    get(_target, prop, receiver) {
      const client = getClient() as unknown as Record<PropertyKey, unknown>
      const value = Reflect.get(client, prop, receiver)
      return typeof value === 'function' ? value.bind(client) : value
    },
    set(_target, prop, value, receiver) {
      return Reflect.set(getClient() as unknown as Record<PropertyKey, unknown>, prop, value, receiver)
    },
    has(_target, prop) {
      return prop in (getClient() as unknown as Record<PropertyKey, unknown>)
    },
    ownKeys() {
      return Reflect.ownKeys(getClient() as unknown as Record<PropertyKey, unknown>)
    },
    getOwnPropertyDescriptor(_target, prop) {
      return Reflect.getOwnPropertyDescriptor(getClient() as unknown as Record<PropertyKey, unknown>, prop)
    },
  })
}

export const redis = createLazyRedisProxy(getAppRedis)

export function createSubscriber() {
  const client = new Redis({
    ...buildBaseConfig(),
    maxRetriesPerRequest: null,
  })
  onConnectLog('sub', client)
  return client
}
