import { randomUUID } from 'node:crypto'
import { redis } from '@/lib/redis'
import { createScopedLogger } from '@/lib/logging/core'
import type { ProjectAssistantId } from './types'
import { buildProjectAssistantScopeRef } from './persistence'

interface ProjectAgentRunLockScope {
  projectId: string
  userId: string
  episodeId?: string | null
  assistantId?: ProjectAssistantId
}

interface AcquireProjectAgentRunLockInput extends ProjectAgentRunLockScope {
  runId: string
}

export interface ProjectAgentRunLock {
  key: string
  token: string
  runId: string
}

const RUN_LOCK_TTL_MS = 75 * 1000

const projectAgentRunLockLogger = createScopedLogger({
  module: 'project-agent.run-lock',
})

function buildProjectAgentRunLockKey(input: ProjectAgentRunLockScope): string {
  const assistantId = input.assistantId ?? 'workspace-command'
  const scopeRef = buildProjectAssistantScopeRef({
    projectId: input.projectId,
    episodeId: input.episodeId ?? null,
  })
  return [
    'project-agent-run',
    input.projectId,
    input.userId,
    assistantId,
    scopeRef,
  ].join(':')
}

function formatProjectAgentRunLockValue(input: Pick<ProjectAgentRunLock, 'runId' | 'token'>): string {
  return `${input.runId}:${input.token}`
}

export async function acquireProjectAgentRunLock(input: AcquireProjectAgentRunLockInput): Promise<ProjectAgentRunLock | null> {
  const key = buildProjectAgentRunLockKey(input)
  const token = randomUUID()
  const runId = input.runId.trim()
  if (!runId) throw new Error('PROJECT_AGENT_RUN_LOCK_RUN_ID_REQUIRED')
  const acquired = await redis.set(key, formatProjectAgentRunLockValue({ runId, token }), 'PX', RUN_LOCK_TTL_MS, 'NX')
  if (acquired !== 'OK') return null
  return { key, token, runId }
}

export async function isProjectAgentRunLockActive(input: ProjectAgentRunLockScope): Promise<boolean> {
  const key = buildProjectAgentRunLockKey(input)
  const token = await redis.get(key)
  return typeof token === 'string' && token.length > 0
}

export async function releaseProjectAgentRunLock(lock: ProjectAgentRunLock): Promise<void> {
  const releaseScript = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    end
    return 0
  `
  await redis.eval(releaseScript, 1, lock.key, formatProjectAgentRunLockValue(lock))
}

export async function renewProjectAgentRunLock(lock: ProjectAgentRunLock): Promise<boolean> {
  const renewScript = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("PEXPIRE", KEYS[1], ARGV[2])
    end
    return 0
  `
  const renewed = await redis.eval(renewScript, 1, lock.key, formatProjectAgentRunLockValue(lock), RUN_LOCK_TTL_MS)
  return renewed === 1
}

export async function releaseProjectAgentRunLockForRun(input: ProjectAgentRunLockScope & {
  runId: string
}): Promise<boolean> {
  const key = buildProjectAgentRunLockKey(input)
  const releaseScript = `
    local value = redis.call("GET", KEYS[1])
    if value and string.sub(value, 1, string.len(ARGV[1])) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    end
    return 0
  `
  const released = await redis.eval(releaseScript, 1, key, `${input.runId}:`)
  return released === 1
}

export async function safelyReleaseProjectAgentRunLock(lock: ProjectAgentRunLock): Promise<void> {
  try {
    await releaseProjectAgentRunLock(lock)
  } catch (error) {
    projectAgentRunLockLogger.error({
      action: 'assistant.run-lock.release.failed',
      message: 'Failed to release project agent run lock',
      details: {
        key: lock.key,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }
}
