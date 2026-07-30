import { createScopedLogger } from '@/lib/logging/core'
import { addOutboxJob, observeOutboxJob } from './queue'
import {
  listOutboxCommandsAwaitingEnqueue,
  markOutboxCommandEnqueued,
  resetOutboxCommandEnqueue,
} from './repository'
import { prisma } from '@/lib/prisma'
import { OUTBOX_COMMAND_KIND } from '@/lib/outbox/types'
import { getOutboxRuntimeConfig } from '@/lib/workers/runtime-config'

const logger = createScopedLogger({ module: 'outbox.dispatcher' })
const outboxConfig = getOutboxRuntimeConfig()

/**
 * Log-only extraction: reads taskId from raw persisted payload JSON without
 * enforcing the payload contract (the worker owns strict parsing).
 */
function readOutboxTaskIdForLog(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const record = payload as { kind?: unknown; taskId?: unknown }
  if (
    record.kind !== OUTBOX_COMMAND_KIND.TASK_ENQUEUE
    && record.kind !== OUTBOX_COMMAND_KIND.TASK_LIFECYCLE_BROADCAST
  ) {
    return undefined
  }
  return typeof record.taskId === 'string' && record.taskId ? record.taskId : undefined
}

async function dispatchOutboxCommand(commandId: string): Promise<void> {
  await addOutboxJob(commandId)
  await markOutboxCommandEnqueued(commandId)
}

export async function dispatchPendingOutboxCommands(limit = 100): Promise<number> {
  const commands = await listOutboxCommandsAwaitingEnqueue(limit)
  // deliveryCount === 0 means no worker ever received this command, so the
  // committing owner never fast-dispatched it: either a real missing dispatch
  // owner or a crash between commit and dispatch. Re-armed retries always
  // carry a delivery, so they stay silent here.
  const missedFastDispatch = commands.filter((command) => command.deliveryCount === 0)
  const oldestMissed = missedFastDispatch[0]
  if (oldestMissed) {
    logger.warn({
      action: 'outbox.periodic_dispatch.missed_fast_dispatch',
      message: 'periodic dispatcher recovered commands that no committing owner dispatched',
      details: {
        count: missedFastDispatch.length,
        kinds: [...new Set(missedFastDispatch.map((command) => command.kind))],
        oldestAgeMs: Date.now() - oldestMissed.createdAt.getTime(),
      },
    })
  }
  let dispatched = 0
  for (const command of commands) {
    await dispatchOutboxCommand(command.id)
    dispatched += 1
  }
  return dispatched
}

/**
 * Fast path after the transaction that created these durable commands commits.
 * A transport failure is deliberately non-fatal: the periodic dispatcher owns
 * crash recovery from the same persisted Outbox rows.
 */
export async function dispatchCommittedOutboxCommands(commandIds: readonly string[]): Promise<number> {
  const uniqueIds = [...new Set(commandIds.filter((id) => id.trim().length > 0))]
  if (uniqueIds.length === 0) return 0
  let dispatched = 0
  for (const commandId of uniqueIds) {
    let taskIdForLog: string | undefined
    try {
      const command = await prisma.outboxCommand.findFirst({
        where: {
          id: commandId,
          acceptedAt: null,
          deadAt: null,
          availableAt: { lte: new Date() },
        },
        select: { id: true, payload: true },
      })
      if (!command) continue
      taskIdForLog = readOutboxTaskIdForLog(command.payload)
      await dispatchOutboxCommand(command.id)
      dispatched += 1
    } catch (error) {
      logger.error({
        action: 'outbox.commit_dispatch.failed',
        message: 'committed outbox command will be recovered by the durable dispatcher',
        taskId: taskIdForLog,
        details: { outboxId: commandId },
        error: error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { message: String(error) },
      })
    }
  }
  return dispatched
}

export async function reconcileStaleEnqueuedOutboxCommands(limit = 100): Promise<number> {
  const staleBefore = new Date(Date.now() - outboxConfig.staleEnqueuedMs)
  const commands = await prisma.outboxCommand.findMany({
    where: {
      acceptedAt: null,
      deadAt: null,
      enqueuedAt: { lt: staleBefore },
    },
    orderBy: { enqueuedAt: 'asc' },
    take: Math.min(Math.max(Math.floor(limit), 1), 500),
    select: { id: true, payload: true },
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
      taskId: readOutboxTaskIdForLog(command.payload),
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

export function startOutboxDispatcher(): void {
  if (globalForOutboxDispatcher.__waoowaooOutboxDispatcherTimer) return
  const execute = (): void => {
    if (globalForOutboxDispatcher.__waoowaooOutboxDispatchCycle) return
    globalForOutboxDispatcher.__waoowaooOutboxDispatchCycle = runOutboxDispatchCycle()
      .then(() => undefined)
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
  globalForOutboxDispatcher.__waoowaooOutboxDispatcherTimer = setInterval(
    execute,
    outboxConfig.dispatchIntervalMs,
  )
}
