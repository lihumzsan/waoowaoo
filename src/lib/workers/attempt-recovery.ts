import { describeUnknownError } from '@/lib/errors/normalize'
import { createScopedLogger } from '@/lib/logging/core'
import { prisma } from '@/lib/prisma'
import { TASK_STATUS } from '@/lib/task/types'

/**
 * Attempt ownership recovery for worker deliveries.
 *
 * TL-03: a DB Task attempt has exactly one executing owner. When a stalled
 * BullMQ redelivery meets a `processing` attempt, the heartbeat decides
 * whether that owner is still alive:
 * - fresh heartbeat  -> another live process owns the attempt; refuse.
 * - stale heartbeat  -> the owner died (crash / dev restart); atomically claim
 *   a NEW attempt over the same Task so this delivery resumes from durable
 *   checkpoints instead of failing the job.
 *
 * Taking over always increments `attempt` so the previous owner (if it is a
 * paused-but-alive process) loses all attempt-fenced write power; this keeps
 * heartbeat, progress and terminal writers unique.
 */

export const TASK_ATTEMPT_HEARTBEAT_STALE_MS = 60_000

const logger = createScopedLogger({ module: 'workers.attempt-recovery' })

export type StaleAttemptTakeoverResult =
  | { readonly kind: 'taken_over'; readonly attempt: number }
  | { readonly kind: 'refused' }

export async function tryTakeOverStaleProcessingAttempt(params: {
  readonly taskId: string
  readonly observedAttempt: number
  readonly staleMs?: number
}): Promise<StaleAttemptTakeoverResult> {
  const staleMs = params.staleMs ?? TASK_ATTEMPT_HEARTBEAT_STALE_MS
  const staleCutoff = new Date(Date.now() - staleMs)
  const updated = await prisma.task.updateMany({
    where: {
      id: params.taskId,
      status: TASK_STATUS.PROCESSING,
      attempt: params.observedAttempt,
      OR: [
        { heartbeatAt: null },
        { heartbeatAt: { lt: staleCutoff } },
      ],
    },
    data: {
      attempt: { increment: 1 },
      startedAt: new Date(),
      heartbeatAt: new Date(),
    },
  })
  if (updated.count !== 1) return { kind: 'refused' }
  return { kind: 'taken_over', attempt: params.observedAttempt + 1 }
}

type InFlightTaskAttempt = {
  readonly taskId: string
  readonly attempt: number
}

const inFlightTaskAttempts = new Map<string, InFlightTaskAttempt>()
let shutdownReleaseActive = false

export function registerInFlightTaskAttempt(taskId: string, attempt: number): void {
  inFlightTaskAttempts.set(taskId, { taskId, attempt })
}

export function unregisterInFlightTaskAttempt(taskId: string): void {
  inFlightTaskAttempts.delete(taskId)
}

/** After shutdown release, in-process heartbeats must stop refreshing abandoned attempts. */
export function isTaskHeartbeatReleaseActive(): boolean {
  return shutdownReleaseActive
}

/**
 * Graceful-shutdown handoff: abandon ownership of still-running attempts
 * WITHOUT marking them failed. Setting `heartbeatAt = null` makes the attempt
 * immediately stale, so the BullMQ stalled redelivery can take it over the
 * moment it arrives instead of waiting out the heartbeat window.
 */
export async function releaseInFlightTaskAttempts(): Promise<number> {
  shutdownReleaseActive = true
  let released = 0
  for (const entry of inFlightTaskAttempts.values()) {
    try {
      const updated = await prisma.task.updateMany({
        where: {
          id: entry.taskId,
          status: TASK_STATUS.PROCESSING,
          attempt: entry.attempt,
        },
        data: { heartbeatAt: null },
      })
      released += updated.count
    } catch (error) {
      logger.warn({
        action: 'worker.shutdown.release_attempt_failed',
        message: 'failed to release in-flight task attempt ownership during shutdown',
        taskId: entry.taskId,
        error: error instanceof Error
          ? { name: error.name, message: error.message }
          : { message: describeUnknownError(error) },
      })
    }
  }
  inFlightTaskAttempts.clear()
  return released
}
