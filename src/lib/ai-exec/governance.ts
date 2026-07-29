import { createScopedLogger } from '@/lib/logging/core'

type ConcurrencyScope = 'image' | 'video'

interface GateState {
  active: number
  waitingResolvers: Array<() => void>
}

const gateStateMap = new Map<string, GateState>()

const logger = createScopedLogger({ module: 'ai-exec.governance' })

const GATE_WAIT_HEARTBEAT_MS = 60_000

type GateWaitLogContext = {
  scope: ConcurrencyScope
  userId: string
}

type ConcurrencyGateMode = 'memory' | 'redis'

function resolveConcurrencyGateMode(): ConcurrencyGateMode {
  const raw = process.env.AI_CONCURRENCY_GATE_MODE
  if (!raw || raw === 'memory') return 'memory'
  if (raw === 'redis') return 'redis'
  throw new Error(`AI_CONCURRENCY_GATE_MODE_INVALID: ${raw}`)
}

function resolveRedisGateTtlMs(): number {
  const raw = process.env.AI_CONCURRENCY_GATE_TTL_MS
  if (!raw) return 30 * 60 * 1000
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 60_000) {
    throw new Error(`AI_CONCURRENCY_GATE_TTL_MS_INVALID: ${raw}`)
  }
  return parsed
}

function getGateState(key: string): GateState {
  const existing = gateStateMap.get(key)
  if (existing) return existing
  const created: GateState = { active: 0, waitingResolvers: [] }
  gateStateMap.set(key, created)
  return created
}

function cleanupGateStateIfIdle(key: string) {
  const state = gateStateMap.get(key)
  if (!state) return
  if (state.active === 0 && state.waitingResolvers.length === 0) {
    gateStateMap.delete(key)
  }
}

async function acquireConcurrencySlot(key: string, limit: number, waitContext: GateWaitLogContext): Promise<void> {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`WORKFLOW_CONCURRENCY_INVALID: ${limit}`)
  }

  const state = getGateState(key)
  if (state.active < limit) {
    state.active += 1
    return
  }

  const waitStartedAt = Date.now()
  logger.info({
    action: 'concurrency.gate.wait.started',
    message: 'concurrency gate saturated; waiting for a slot',
    userId: waitContext.userId,
    details: { mode: 'memory', scope: waitContext.scope, limit, queued: state.waitingResolvers.length },
  })
  // Observability only: a leaked slot would otherwise block this waiter forever
  // with zero log output. The interval never times the wait out.
  const heartbeat = setInterval(() => {
    logger.warn({
      action: 'concurrency.gate.wait.heartbeat',
      message: 'concurrency gate wait still blocked',
      userId: waitContext.userId,
      durationMs: Date.now() - waitStartedAt,
      details: { mode: 'memory', scope: waitContext.scope, limit },
    })
  }, GATE_WAIT_HEARTBEAT_MS)
  try {
    await new Promise<void>((resolve) => {
      state.waitingResolvers.push(resolve)
    })
  } finally {
    clearInterval(heartbeat)
  }
  logger.info({
    action: 'concurrency.gate.wait.acquired',
    message: 'concurrency gate slot acquired after waiting',
    userId: waitContext.userId,
    durationMs: Date.now() - waitStartedAt,
    details: { mode: 'memory', scope: waitContext.scope, limit },
  })
}

function releaseConcurrencySlot(key: string) {
  const state = gateStateMap.get(key)
  if (!state) return

  if (state.waitingResolvers.length > 0) {
    const nextResolver = state.waitingResolvers.shift()
    nextResolver?.()
    return
  }

  state.active = Math.max(0, state.active - 1)
  cleanupGateStateIfIdle(key)
}

async function acquireConcurrencySlotRedis(input: {
  key: string
  limit: number
  ttlMs: number
  waitContext: GateWaitLogContext
}): Promise<{ stopHeartbeat: () => void; release: () => Promise<void> }> {
  if (!Number.isInteger(input.limit) || input.limit <= 0) {
    throw new Error(`WORKFLOW_CONCURRENCY_INVALID: ${input.limit}`)
  }

  const { queueRedis } = await import('@/lib/redis')
  const acquireScript = [
    'local key=KEYS[1]',
    'local limit=tonumber(ARGV[1])',
    'local ttl=tonumber(ARGV[2])',
    "local current=tonumber(redis.call('GET', key) or '0')",
    'if current < limit then',
    "  redis.call('INCR', key)",
    "  redis.call('PEXPIRE', key, ttl)",
    '  return 1',
    'end',
    'return 0',
  ].join('\n')

  const releaseScript = [
    'local key=KEYS[1]',
    "local current=tonumber(redis.call('GET', key) or '0')",
    'if current <= 0 then',
    '  return 0',
    'end',
    "local next=tonumber(redis.call('DECR', key) or '0')",
    'if next <= 0 then',
    "  redis.call('DEL', key)",
    'end',
    'return next',
  ].join('\n')

  let attempt = 0
  const waitStartedAt = Date.now()
  let waited = false
  let lastHeartbeatAt = waitStartedAt
  while (true) {
    attempt += 1
    const acquired = await queueRedis.eval(acquireScript, 1, input.key, String(input.limit), String(input.ttlMs)) as unknown
    if (acquired === 1 || acquired === '1') break
    if (!waited) {
      waited = true
      logger.info({
        action: 'concurrency.gate.wait.started',
        message: 'concurrency gate saturated; polling for a slot',
        userId: input.waitContext.userId,
        details: { mode: 'redis', scope: input.waitContext.scope, limit: input.limit, ttlMs: input.ttlMs },
      })
    }
    // Observability only: a leaked Redis counter can block waiters for up to the
    // gate TTL, so emit a WARN heartbeat at least every 60s while still blocked.
    const now = Date.now()
    if (now - lastHeartbeatAt >= GATE_WAIT_HEARTBEAT_MS) {
      lastHeartbeatAt = now
      logger.warn({
        action: 'concurrency.gate.wait.heartbeat',
        message: 'concurrency gate wait still blocked',
        userId: input.waitContext.userId,
        durationMs: now - waitStartedAt,
        details: { mode: 'redis', scope: input.waitContext.scope, limit: input.limit, ttlMs: input.ttlMs, attempt },
      })
    }
    const delayMs = Math.min(200 * attempt, 1000)
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  if (waited) {
    logger.info({
      action: 'concurrency.gate.wait.acquired',
      message: 'concurrency gate slot acquired after waiting',
      userId: input.waitContext.userId,
      durationMs: Date.now() - waitStartedAt,
      details: { mode: 'redis', scope: input.waitContext.scope, limit: input.limit, attempts: attempt },
    })
  }

  const heartbeat = setInterval(() => {
    void queueRedis.pexpire(input.key, input.ttlMs).catch(() => undefined)
  }, Math.max(10_000, Math.floor(input.ttlMs / 2)))

  return {
    stopHeartbeat: () => clearInterval(heartbeat),
    release: async () => {
      await queueRedis.eval(releaseScript, 1, input.key)
    },
  }
}

export async function withAiConcurrencyGate<T>(input: {
  scope: ConcurrencyScope
  userId: string
  limit: number
  run: () => Promise<T>
}): Promise<T> {
  const mode = resolveConcurrencyGateMode()
  const key = `${input.scope}:${input.userId}`
  const waitContext: GateWaitLogContext = { scope: input.scope, userId: input.userId }

  if (mode === 'redis') {
    const redisKey = `ai_concurrency_gate:${key}`
    const gate = await acquireConcurrencySlotRedis({
      key: redisKey,
      limit: input.limit,
      ttlMs: resolveRedisGateTtlMs(),
      waitContext,
    })
    try {
      return await input.run()
    } finally {
      gate.stopHeartbeat()
      await gate.release()
    }
  }

  await acquireConcurrencySlot(key, input.limit, waitContext)
  try {
    return await input.run()
  } finally {
    releaseConcurrencySlot(key)
  }
}
