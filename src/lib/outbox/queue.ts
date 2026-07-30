import { describeUnknownError } from '@/lib/errors/normalize'
import { Queue } from 'bullmq'
import { queueRedis } from '@/lib/redis'
import { createScopedLogger } from '@/lib/logging/core'

export const OUTBOX_QUEUE_NAME = 'waoowaoo-outbox'
const logger = createScopedLogger({ module: 'outbox.queue' })

export type OutboxJobData = {
  outboxId: string
}

const globalForOutboxQueue = globalThis as typeof globalThis & {
  __waoowaooOutboxQueue?: Queue<OutboxJobData>
}

export function getOutboxQueue(): Queue<OutboxJobData> {
  if (globalForOutboxQueue.__waoowaooOutboxQueue) return globalForOutboxQueue.__waoowaooOutboxQueue
  const queue = new Queue<OutboxJobData>(OUTBOX_QUEUE_NAME, {
    connection: queueRedis,
    defaultJobOptions: {
      removeOnComplete: 500,
      removeOnFail: 500,
    },
  })
  globalForOutboxQueue.__waoowaooOutboxQueue = queue
  return queue
}

export async function addOutboxJob(outboxId: string) {
  const queue = getOutboxQueue()
  const existing = await queue.getJob(outboxId)
  if (existing) {
    const state = await existing.getState()
    if (state !== 'completed' && state !== 'failed') return existing
    await existing.remove()
  }
  return await queue.add('deliver', { outboxId }, {
    jobId: outboxId,
    attempts: 5,
    backoff: { type: 'exponential', delay: 1_000 },
  })
}

export type OutboxJobObservation =
  | 'alive'
  | 'absent'
  | 'unavailable'
  | { state: 'terminal'; jobState: 'completed' | 'failed'; failedReason: string | null }

export async function observeOutboxJobWithQueue(
  outboxId: string,
  queue: Pick<Queue<OutboxJobData>, 'getJob'>,
): Promise<OutboxJobObservation> {
  try {
    const job = await queue.getJob(outboxId)
    if (!job) return 'absent'
    const state = await job.getState()
    if (state === 'completed' || state === 'failed') {
      return { state: 'terminal', jobState: state, failedReason: job.failedReason || null }
    }
    return 'alive'
  } catch (error) {
    logger.error({
      action: 'outbox.job.observe_failed',
      message: 'BullMQ outbox job observation failed',
      details: { outboxId },
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { message: describeUnknownError(error) },
    })
    return 'unavailable'
  }
}

export async function observeOutboxJob(outboxId: string): Promise<OutboxJobObservation> {
  return await observeOutboxJobWithQueue(outboxId, getOutboxQueue())
}
