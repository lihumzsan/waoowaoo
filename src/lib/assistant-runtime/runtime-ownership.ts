import { createHash } from 'node:crypto'
import type {
  RuntimeSessionOwnership,
  RuntimeSessionOwnershipClaim,
  RuntimeSessionScope,
} from '@/lib/codex-runtime/runtime-session-manager'
import { redis } from '@/lib/redis'

const OWNERSHIP_LEASE_MS = 45_000
const OWNERSHIP_RENEW_MS = 15_000

const OWNERSHIP_RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`

const OWNERSHIP_RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

function requireIdentity(value: string, code: string): string {
  if (value !== value.trim() || !/^[A-Za-z0-9_-]{1,191}$/u.test(value)) {
    throw new Error(code)
  }
  return value
}

function ownershipKey(scope: RuntimeSessionScope): string {
  const hash = createHash('sha256')
  for (const value of [
    requireIdentity(scope.userId, 'ASSISTANT_RUNTIME_SCOPE_USER_INVALID'),
    requireIdentity(scope.projectId, 'ASSISTANT_RUNTIME_SCOPE_PROJECT_INVALID'),
  ]) {
    const bytes = Buffer.from(value, 'utf8')
    const length = Buffer.allocUnsafe(4)
    length.writeUInt32BE(bytes.length)
    hash.update(length)
    hash.update(bytes)
  }
  return `assistant-runtime:owner:v2:${hash.digest('hex')}`
}

/** The bearer generation is valid only while it owns the live Runtime lease. */
export async function hasAssistantRuntimeOwnership(
  scope: RuntimeSessionScope,
  ownerTokenValue: string,
): Promise<boolean> {
  const ownerToken = requireIdentity(
    ownerTokenValue,
    'ASSISTANT_RUNTIME_SESSION_OWNER_TOKEN_INVALID',
  )
  return await redis.get(ownershipKey(scope)) === ownerToken
}

export class RedisAssistantRuntimeOwnership implements RuntimeSessionOwnership {
  async acquire(
    scope: RuntimeSessionScope,
    ownerTokenValue: string,
  ): Promise<RuntimeSessionOwnershipClaim> {
    const key = ownershipKey(scope)
    const ownerToken = requireIdentity(
      ownerTokenValue,
      'ASSISTANT_RUNTIME_SESSION_OWNER_TOKEN_INVALID',
    )
    const acquired = await redis.set(key, ownerToken, 'PX', OWNERSHIP_LEASE_MS, 'NX')
    if (acquired !== 'OK') throw new Error('ASSISTANT_RUNTIME_OWNERSHIP_BUSY')
    let active = true
    let timer: NodeJS.Timeout | null = null
    let resolveLost: (() => void) | null = null
    const lost = new Promise<void>((resolve) => {
      resolveLost = resolve
    })
    const markLost = (): void => {
      if (!active) return
      active = false
      if (timer) clearTimeout(timer)
      resolveLost?.()
    }
    const schedule = (): void => {
      if (!active) return
      timer = setTimeout(() => {
        void redis.eval(
          OWNERSHIP_RENEW_SCRIPT,
          1,
          key,
          ownerToken,
          String(OWNERSHIP_LEASE_MS),
        ).then((result) => {
          if (result !== 1) {
            markLost()
            return
          }
          schedule()
        }).catch(() => {
          markLost()
        })
      }, OWNERSHIP_RENEW_MS)
      timer.unref()
    }
    schedule()
    return {
      ownerToken,
      lost,
      async assertCurrent() {
        if (!active) throw new Error('ASSISTANT_RUNTIME_OWNERSHIP_LOST')
        let current: string | null
        try {
          current = await redis.get(key)
        } catch (error) {
          markLost()
          throw new Error('ASSISTANT_RUNTIME_OWNERSHIP_CHECK_FAILED', { cause: error })
        }
        if (current !== ownerToken) {
          markLost()
          throw new Error('ASSISTANT_RUNTIME_OWNERSHIP_LOST')
        }
      },
      async release() {
        if (!active) return
        active = false
        if (timer) clearTimeout(timer)
        await redis.eval(OWNERSHIP_RELEASE_SCRIPT, 1, key, ownerToken)
      },
    }
  }
}
