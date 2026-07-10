import { createScopedLogger } from '@/lib/logging/core'
import { addOutboxJob, observeOutboxJob } from './queue'
import {
  listOutboxCommandsAwaitingEnqueue,
  markOutboxCommandEnqueued,
  resetOutboxCommandEnqueue,
} from './repository'
import { prisma } from '@/lib/prisma'

const logger = createScopedLogger({ module: 'outbox.dispatcher' })
const STALE_ENQUEUED_MS = 90_000

export async function dispatchPendingOutboxCommands(limit = 100): Promise<number> {
  const commands = await listOutboxCommandsAwaitingEnqueue(limit)
  let dispatched = 0
  for (const command of commands) {
    await addOutboxJob(command.id)
    await markOutboxCommandEnqueued(command.id)
    dispatched += 1
  }
  return dispatched
}

export async function reconcileStaleEnqueuedOutboxCommands(limit = 100): Promise<number> {
  const staleBefore = new Date(Date.now() - STALE_ENQUEUED_MS)
  const commands = await prisma.outboxCommand.findMany({
    where: {
      acceptedAt: null,
      deadAt: null,
      enqueuedAt: { lt: staleBefore },
    },
    orderBy: { enqueuedAt: 'asc' },
    take: Math.min(Math.max(Math.floor(limit), 1), 500),
    select: { id: true },
  })
  let reset = 0
  for (const command of commands) {
    const observation = await observeOutboxJob(command.id)
    if (observation === 'alive' || observation === 'unavailable') continue
    await resetOutboxCommandEnqueue(command.id)
    reset += 1
    logger.warn({
      action: 'outbox.enqueue.reset',
      message: 'stale outbox transport was reset for deterministic re-enqueue',
      details: { outboxId: command.id, observation },
    })
  }
  return reset
}

export async function runOutboxDispatchCycle(): Promise<{ dispatched: number; reset: number }> {
  const reset = await reconcileStaleEnqueuedOutboxCommands()
  const dispatched = await dispatchPendingOutboxCommands()
  return { dispatched, reset }
}

const globalForOutboxDispatcher = globalThis as typeof globalThis & {
  __waoowaooOutboxDispatcherTimer?: ReturnType<typeof setInterval>
  __waoowaooOutboxDispatchCycle?: Promise<void>
}

export function startOutboxDispatcher(intervalMs = 5_000): void {
  if (globalForOutboxDispatcher.__waoowaooOutboxDispatcherTimer) return
  const execute = (): void => {
    if (globalForOutboxDispatcher.__waoowaooOutboxDispatchCycle) return
    globalForOutboxDispatcher.__waoowaooOutboxDispatchCycle = runOutboxDispatchCycle()
      .then(({ dispatched, reset }) => {
        if (dispatched > 0 || reset > 0) {
          logger.info({
            action: 'outbox.dispatch.cycle',
            message: 'durable outbox dispatch cycle completed',
            details: { dispatched, reset },
          })
        }
      })
      .catch((error: unknown) => {
        logger.error({
          action: 'outbox.dispatch.failed',
          message: 'durable outbox dispatch cycle failed',
          error: error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : { message: String(error) },
        })
      })
      .finally(() => {
        globalForOutboxDispatcher.__waoowaooOutboxDispatchCycle = undefined
      })
  }
  execute()
  globalForOutboxDispatcher.__waoowaooOutboxDispatcherTimer = setInterval(execute, Math.max(1_000, intervalMs))
}
