import { UnrecoverableError, Worker, type Job } from 'bullmq'
import { randomUUID } from 'node:crypto'
import { queueRedis } from '@/lib/redis'
import { createScopedLogger } from '@/lib/logging/core'
import {
  acceptOutboxCommand,
  claimOutboxCommand,
  extendOutboxCommandLease,
  releaseOutboxCommand,
} from '@/lib/outbox/repository'
import { OUTBOX_QUEUE_NAME, type OutboxJobData } from '@/lib/outbox/queue'
import {
  OUTBOX_COMMAND_KIND,
  OutboxPermanentError,
  parseOutboxCommandPayload,
} from '@/lib/outbox/types'
import { publishPersistedTaskEventById } from '@/lib/task/publisher'
import { runProjectAgentWaitContinuationCommand } from '@/lib/project-agent/server-follow-up'

const logger = createScopedLogger({ module: 'worker.outbox' })
const OUTBOX_LEASE_MS = 15 * 60 * 1000

async function deliverOutboxCommand(job: Job<OutboxJobData>): Promise<void> {
  const outboxId = job.data.outboxId
  if (!outboxId || outboxId !== job.id) {
    throw new UnrecoverableError(`OUTBOX_JOB_ID_MISMATCH:${String(job.id)}:${outboxId}`)
  }
  const leaseOwner = `bullmq:${outboxId}:${String(job.attemptsMade)}:${randomUUID()}`
  const row = await claimOutboxCommand({ id: outboxId, leaseOwner, leaseMs: OUTBOX_LEASE_MS })
  if (!row) return
  let leaseLost = false
  const leaseHeartbeat = setInterval(() => {
    void extendOutboxCommandLease({ id: outboxId, leaseOwner, leaseMs: OUTBOX_LEASE_MS })
      .then((extended) => {
        if (!extended) leaseLost = true
      })
      .catch((error: unknown) => {
        leaseLost = true
        logger.error({
          action: 'outbox.lease.extend_failed',
          message: 'outbox delivery lease heartbeat failed',
          details: { outboxId },
          error: error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : { message: String(error) },
        })
      })
  }, 60_000)

  try {
    const payload = parseOutboxCommandPayload(row.payload)
    if (row.kind !== payload.kind || row.version !== payload.version) {
      throw new OutboxPermanentError(`OUTBOX_ROW_CONTRACT_MISMATCH:${outboxId}`)
    }
    switch (payload.kind) {
      case OUTBOX_COMMAND_KIND.TASK_LIFECYCLE_BROADCAST:
        await publishPersistedTaskEventById(payload.eventId, payload.taskId)
        break
      case OUTBOX_COMMAND_KIND.PROJECT_AGENT_CONTINUE_WAIT:
        await runProjectAgentWaitContinuationCommand(payload, outboxId)
        break
    }
    if (leaseLost) throw new Error(`OUTBOX_LEASE_LOST:${outboxId}`)
    const accepted = await acceptOutboxCommand({ id: outboxId, leaseOwner })
    if (!accepted) throw new Error(`OUTBOX_ACCEPT_CAS_FAILED:${outboxId}`)
  } catch (error) {
    const attempts = typeof job.opts.attempts === 'number' ? Math.max(1, job.opts.attempts) : 1
    const currentAttempt = job.attemptsMade + 1
    const permanent = error instanceof OutboxPermanentError
    const dead = permanent || currentAttempt >= attempts
    const message = error instanceof Error ? error.message : String(error)
    await releaseOutboxCommand({
      id: outboxId,
      leaseOwner,
      error: message,
      retryAt: new Date(Date.now() + Math.min(60_000, 1_000 * 2 ** Math.max(0, job.attemptsMade))),
      dead,
    })
    logger.error({
      action: dead ? 'outbox.delivery.dead' : 'outbox.delivery.retry',
      message,
      details: { outboxId, kind: row.kind, currentAttempt, attempts },
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { message },
    })
    if (dead) throw new UnrecoverableError(message)
    throw error
  } finally {
    clearInterval(leaseHeartbeat)
  }
}

export function createOutboxWorker(): Worker<OutboxJobData> {
  return new Worker<OutboxJobData>(
    OUTBOX_QUEUE_NAME,
    deliverOutboxCommand,
    {
      connection: queueRedis,
      concurrency: Number.parseInt(process.env.QUEUE_CONCURRENCY_OUTBOX || '10', 10) || 10,
    },
  )
}
