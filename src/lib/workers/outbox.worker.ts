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
import { enqueuePersistedTask } from '@/lib/task/enqueue'
import {
  runProjectAgentWaitContinuationCommand,
  settleProjectAgentWaitContinuationDeliveryExhausted,
} from '@/lib/project-agent/server-follow-up'
import { publishPersistedProjectAgentSessionChangedById } from '@/lib/project-agent/session-event'
import { getOutboxRuntimeConfig, getWorkerConcurrency } from './runtime-config'

const logger = createScopedLogger({ module: 'worker.outbox' })
const outboxConfig = getOutboxRuntimeConfig()

async function deliverOutboxCommand(job: Job<OutboxJobData>): Promise<void> {
  const outboxId = job.data.outboxId
  if (!outboxId || outboxId !== job.id) {
    throw new UnrecoverableError(`OUTBOX_JOB_ID_MISMATCH:${String(job.id)}:${outboxId}`)
  }
  const leaseOwner = `bullmq:${outboxId}:${randomUUID()}`
  const row = await claimOutboxCommand({ id: outboxId, leaseOwner, leaseMs: outboxConfig.leaseMs })
  if (!row) return
  let payload: ReturnType<typeof parseOutboxCommandPayload> | null = null
  let leaseLost = false
  const leaseHeartbeat = setInterval(() => {
    void extendOutboxCommandLease({ id: outboxId, leaseOwner, leaseMs: outboxConfig.leaseMs })
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
  }, Math.max(1_000, Math.floor(outboxConfig.leaseMs / 3)))

  try {
    try {
      payload = parseOutboxCommandPayload(row.payload)
    } catch (error) {
      throw new OutboxPermanentError(
        error instanceof Error ? error.message : `OUTBOX_COMMAND_PAYLOAD_INVALID:${String(error)}`,
      )
    }
    if (row.kind !== payload.kind) {
      throw new OutboxPermanentError(`OUTBOX_ROW_CONTRACT_MISMATCH:${outboxId}`)
    }
    switch (payload.kind) {
      case OUTBOX_COMMAND_KIND.TASK_ENQUEUE:
        await enqueuePersistedTask(payload)
        break
      case OUTBOX_COMMAND_KIND.TASK_LIFECYCLE_BROADCAST:
        await publishPersistedTaskEventById(payload.eventId, payload.taskId)
        break
      case OUTBOX_COMMAND_KIND.PROJECT_AGENT_CONTINUE_WAIT:
        await runProjectAgentWaitContinuationCommand(payload, outboxId)
        break
      case OUTBOX_COMMAND_KIND.PROJECT_AGENT_SESSION_BROADCAST:
        await publishPersistedProjectAgentSessionChangedById(payload.projectAgentEventId)
        break
    }
    if (leaseLost) throw new Error(`OUTBOX_LEASE_LOST:${outboxId}`)
    const accepted = await acceptOutboxCommand({ id: outboxId, leaseOwner })
    if (!accepted) throw new Error(`OUTBOX_ACCEPT_CAS_FAILED:${outboxId}`)
  } catch (error) {
    const currentAttempt = row.deliveryCount
    const attempts = outboxConfig.maxDeliveryAttempts
    const permanent = error instanceof OutboxPermanentError
    const dead = permanent || currentAttempt >= attempts
    const message = error instanceof Error ? error.message : String(error)
    if (dead && payload?.kind === OUTBOX_COMMAND_KIND.PROJECT_AGENT_CONTINUE_WAIT) {
      try {
        await settleProjectAgentWaitContinuationDeliveryExhausted(payload, outboxId)
      } catch (settlementError) {
        const settlementMessage = settlementError instanceof Error
          ? settlementError.message
          : String(settlementError)
        await releaseOutboxCommand({
          id: outboxId,
          leaseOwner,
          error: settlementMessage,
          retryAt: new Date(Date.now() + Math.min(60_000, 1_000 * 2 ** Math.max(0, currentAttempt - 1))),
          dead: false,
        })
        logger.error({
          action: 'outbox.delivery.assistant_settlement_retry',
          message: settlementMessage,
          details: { outboxId, kind: row.kind, currentAttempt, attempts },
          error: settlementError instanceof Error
            ? { name: settlementError.name, message: settlementError.message, stack: settlementError.stack }
            : { message: settlementMessage },
        })
        throw settlementError
      }
    }
    await releaseOutboxCommand({
      id: outboxId,
      leaseOwner,
      error: message,
      retryAt: new Date(Date.now() + Math.min(60_000, 1_000 * 2 ** Math.max(0, currentAttempt - 1))),
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
      concurrency: getWorkerConcurrency('outbox'),
    },
  )
}
