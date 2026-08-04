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
local connectionKeyCount = #KEYS - 1
local ownerKey = KEYS[#KEYS]
local connectionId = ARGV[connectionKeyCount + 1]
local ownerToken = ARGV[connectionKeyCount + 2]
local ttlMs = tonumber(ARGV[connectionKeyCount + 3])
local expiresAt = now + ttlMs
local complete = 1

for index = 1, connectionKeyCount do
  redis.call('ZREMRANGEBYSCORE', KEYS[index], '-inf', now)
  if redis.call('ZSCORE', KEYS[index], connectionId) == false then
    complete = 0
  end
end

if complete == 0 then
  for index = 1, connectionKeyCount do
    redis.call('ZREM', KEYS[index], connectionId)
  end
  for index = 1, connectionKeyCount do
    if redis.call('ZCARD', KEYS[index]) >= tonumber(ARGV[index]) then
      return 0
    end
  end
end

for index = 1, connectionKeyCount do
  redis.call('ZADD', KEYS[index], expiresAt, connectionId)
  redis.call('PEXPIRE', KEYS[index], ttlMs * 2)
end
redis.call('SET', ownerKey, ownerToken, 'PX', ttlMs * 2)
return 1
`

const RENEW_LEASE_SCRIPT = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local connectionKeyCount = #KEYS - 1
local ownerKey = KEYS[#KEYS]
local connectionId = ARGV[1]
local ownerToken = ARGV[2]
local ttlMs = tonumber(ARGV[3])
local expiresAt = now + ttlMs
local complete = 1

if redis.call('GET', ownerKey) ~= ownerToken then
  return 0
end

for index = 1, connectionKeyCount do
  redis.call('ZREMRANGEBYSCORE', KEYS[index], '-inf', now)
  if redis.call('ZSCORE', KEYS[index], connectionId) == false then
    complete = 0
  end
end

if complete == 0 then
  for index = 1, connectionKeyCount do
    redis.call('ZREM', KEYS[index], connectionId)
  end
  redis.call('DEL', ownerKey)
  return 0
end

for index = 1, connectionKeyCount do
  redis.call('ZADD', KEYS[index], expiresAt, connectionId)
  redis.call('PEXPIRE', KEYS[index], ttlMs * 2)
end
redis.call('PEXPIRE', ownerKey, ttlMs * 2)
return 1
`

const RELEASE_LEASE_SCRIPT = `
local connectionKeyCount = #KEYS - 1
local ownerKey = KEYS[#KEYS]
local connectionId = ARGV[1]
local ownerToken = ARGV[2]

if redis.call('GET', ownerKey) ~= ownerToken then
  return 0
end

local removed = 0
for index = 1, connectionKeyCount do
  removed = removed + redis.call('ZREM', KEYS[index], connectionId)
end
redis.call('DEL', ownerKey)
return removed
`

function scopeDigest(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

function connectionLeaseIdentity(input: {
  readonly userId: string
  readonly projectId: string
  readonly connectionId: string
}): {
  readonly connectionId: string
  readonly keys: readonly [string, string, string, string]
} {
  const user = scopeDigest(input.userId)
  const userProject = scopeDigest(`${input.userId}\u0000${input.projectId}`)
  const connectionId = scopeDigest(
    `${input.userId}\u0000${input.projectId}\u0000${input.connectionId}`,
  )
  return {
    connectionId,
    keys: [
      `sse:connections:user:${user}`,
      `sse:connections:user-project:${userProject}`,
      'sse:connections:global',
      `sse:connections:owner:${connectionId}`,
    ],
  }
}

function isSuccessfulEvalResult(value: unknown): boolean {
  return value === 1 || value === '1'
}

export interface WorkspaceSseConnectionLease {
  readonly ownerToken: string
  renew(): Promise<boolean>
  release(): Promise<void>
}

export async function acquireWorkspaceSseConnectionLease(input: {
  readonly userId: string
  readonly projectId: string
  readonly connectionId: string
}): Promise<WorkspaceSseConnectionLease | null> {
  const { connectionId, keys } = connectionLeaseIdentity(input)
  const ownerToken = randomUUID()
  const acquired = await redis.eval(
    ACQUIRE_LEASE_SCRIPT,
    keys.length,
    ...keys,
    String(WORKSPACE_SSE_CONNECTION_LIMITS.user),
    String(WORKSPACE_SSE_CONNECTION_LIMITS.userProject),
    String(WORKSPACE_SSE_CONNECTION_LIMITS.global),
    connectionId,
    ownerToken,
    String(WORKSPACE_SSE_LEASE_TTL_MS),
  )
  if (!isSuccessfulEvalResult(acquired)) return null

  let released = false
  return {
    ownerToken,
    async renew() {
      if (released) return false
      const renewed = await redis.eval(
        RENEW_LEASE_SCRIPT,
        keys.length,
        ...keys,
        connectionId,
        ownerToken,
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
        connectionId,
        ownerToken,
      )
    },
  }
}
