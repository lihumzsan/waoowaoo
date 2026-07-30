import { createHash, randomUUID } from 'node:crypto'
import { redis } from '@/lib/redis'

export const WORKSPACE_SSE_LEASE_TTL_MS = 75_000
export const WORKSPACE_SSE_LEASE_RENEW_INTERVAL_MS = 25_000

const WORKSPACE_SSE_CONNECTION_LIMITS = {
  user: 8,
  userProject: 4,
  global: 2_000,
} as const

const ACQUIRE_LEASE_SCRIPT = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local keyCount = #KEYS
local token = ARGV[keyCount + 1]
local ttlMs = tonumber(ARGV[keyCount + 2])
local expiresAt = now + ttlMs

for index = 1, keyCount do
  redis.call('ZREMRANGEBYSCORE', KEYS[index], '-inf', now)
  if redis.call('ZCARD', KEYS[index]) >= tonumber(ARGV[index]) then
    return 0
  end
end

for index = 1, keyCount do
  redis.call('ZADD', KEYS[index], expiresAt, token)
  redis.call('PEXPIRE', KEYS[index], ttlMs * 2)
end
return 1
`

const RENEW_LEASE_SCRIPT = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local token = ARGV[1]
local ttlMs = tonumber(ARGV[2])
local expiresAt = now + ttlMs
local complete = 1

for index = 1, #KEYS do
  redis.call('ZREMRANGEBYSCORE', KEYS[index], '-inf', now)
  if redis.call('ZSCORE', KEYS[index], token) == false then
    complete = 0
  end
end

if complete == 0 then
  for index = 1, #KEYS do
    redis.call('ZREM', KEYS[index], token)
  end
  return 0
end

for index = 1, #KEYS do
  redis.call('ZADD', KEYS[index], expiresAt, token)
  redis.call('PEXPIRE', KEYS[index], ttlMs * 2)
end
return 1
`

const RELEASE_LEASE_SCRIPT = `
local removed = 0
for index = 1, #KEYS do
  removed = removed + redis.call('ZREM', KEYS[index], ARGV[1])
end
return removed
`

function scopeDigest(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

function connectionKeys(input: {
  readonly userId: string
  readonly projectId: string
}): readonly [string, string, string] {
  const user = scopeDigest(input.userId)
  const userProject = scopeDigest(`${input.userId}\u0000${input.projectId}`)
  return [
    `sse:connections:user:${user}`,
    `sse:connections:user-project:${userProject}`,
    'sse:connections:global',
  ]
}

function isSuccessfulEvalResult(value: unknown): boolean {
  return value === 1 || value === '1'
}

export interface WorkspaceSseConnectionLease {
  readonly token: string
  renew(): Promise<boolean>
  release(): Promise<void>
}

export async function acquireWorkspaceSseConnectionLease(input: {
  readonly userId: string
  readonly projectId: string
}): Promise<WorkspaceSseConnectionLease | null> {
  const keys = connectionKeys(input)
  const token = randomUUID()
  const acquired = await redis.eval(
    ACQUIRE_LEASE_SCRIPT,
    keys.length,
    ...keys,
    String(WORKSPACE_SSE_CONNECTION_LIMITS.user),
    String(WORKSPACE_SSE_CONNECTION_LIMITS.userProject),
    String(WORKSPACE_SSE_CONNECTION_LIMITS.global),
    token,
    String(WORKSPACE_SSE_LEASE_TTL_MS),
  )
  if (!isSuccessfulEvalResult(acquired)) return null

  let released = false
  return {
    token,
    async renew() {
      if (released) return false
      const renewed = await redis.eval(
        RENEW_LEASE_SCRIPT,
        keys.length,
        ...keys,
        token,
        String(WORKSPACE_SSE_LEASE_TTL_MS),
      )
      return isSuccessfulEvalResult(renewed)
    },
    async release() {
      if (released) return
      released = true
      await redis.eval(
        RELEASE_LEASE_SCRIPT,
        keys.length,
        ...keys,
        token,
      )
    },
  }
}
