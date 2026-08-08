import { describeUnknownError } from '@/lib/errors/normalize'
import { AppError } from '@/lib/errors/app-error'
import { EXTERNAL_OPERATION } from '@/lib/external-operation/registry'
import { createScopedLogger } from '@/lib/logging/core'
import {
  getProviderGenerationTimeoutMs,
  getProviderPollIntervalMs,
  getProviderQueueTimeoutMs,
} from './async-runtime-config'
import type { AsyncPendingPhase } from '@/lib/ai-providers/async-task-types'
import { cancelAsyncTask, pollAsyncTask } from './async-poll'
import { ProviderTaskFailureError } from './provider-errors'

const logger = createScopedLogger({ module: 'ai-exec.async-wait' })

export type AsyncProviderResult = {
  readonly url: string
  readonly status: Awaited<ReturnType<typeof pollAsyncTask>>
  readonly actualVideoTokens?: number
  readonly downloadHeaders?: Record<string, string>
}

export type AsyncProviderPendingProgress = {
  readonly elapsedRatio: number
  readonly phase: AsyncPendingPhase
}

export type AsyncProviderWaitCallbacks = {
  readonly beforePoll?: () => Promise<void>
  readonly onPending?: (progress: AsyncProviderPendingProgress) => Promise<void>
}

/**
 * Thrown when an accepted external job stayed in the provider queue longer than
 * the queue wait budget without ever starting. The generation budget is not
 * consumed by queue wait, so this is a distinct typed failure: callers must
 * durably disown the external id, then best-effort cancel it, then surface a
 * replay-authorized `GENERATION_QUEUE_TIMEOUT` so the next Task attempt submits fresh.
 */
export class ProviderQueueTimeoutError extends Error {
  readonly externalId: string
  readonly queuedMs: number
  readonly queueTimeoutMs: number

  constructor(externalId: string, message: string, budget: { queuedMs: number; queueTimeoutMs: number }) {
    super(message)
    this.name = 'ProviderQueueTimeoutError'
    this.externalId = externalId
    this.queuedMs = budget.queuedMs
    this.queueTimeoutMs = budget.queueTimeoutMs
  }
}

/**
 * Best-effort provider-side cancel for queue-timeout compensation.
 * MUST be called only after the external id has been durably disowned
 * (checkpoint marked replay_authorized + Task.externalId cleared): cancel failure or a
 * crash right here leaves at worst an orphan provider job that no attempt will
 * ever consume, never a double-consumed identity.
 */
export async function cancelAsyncProviderTaskBestEffort(input: {
  readonly externalId: string
  readonly userId: string
}): Promise<void> {
  try {
    const outcome = await cancelAsyncTask(input.externalId, input.userId)
    logger.info({
      action: 'async_wait.cancel_superseded_external_task',
      message: outcome === 'canceled'
        ? 'superseded external task cancel accepted by provider'
        : 'provider does not declare cancel; superseded external task left to expire',
      details: { externalId: input.externalId, outcome },
    })
  } catch (error) {
    logger.warn({
      action: 'async_wait.cancel_superseded_external_task_failed',
      message: 'best-effort cancel of superseded external task failed; the id is already disowned',
      details: { externalId: input.externalId },
      error: error instanceof Error
        ? { name: error.name, message: error.message }
        : { message: describeUnknownError(error) },
    })
  }
}

export async function waitForAsyncProviderResult(input: {
  readonly externalId: string
  readonly userId: string
  readonly timeoutMs?: number
  readonly queueTimeoutMs?: number
  readonly intervalMs?: number
  readonly beforePoll?: () => Promise<void>
  readonly onPending?: (progress: AsyncProviderPendingProgress) => Promise<void>
}): Promise<AsyncProviderResult> {
  const timeoutMs = input.timeoutMs ?? getProviderGenerationTimeoutMs()
  const queueTimeoutMs = input.queueTimeoutMs ?? getProviderQueueTimeoutMs()
  const intervalMs = input.intervalMs ?? getProviderPollIntervalMs()

  // 排队与生成分开计时：provider 报告 `queued` 的时间只消耗排队预算，
  // `running`（或未声明 phase 的 pending）才消耗生成预算。两者互不透支。
  let queuedMs = 0
  let runningMs = 0
  let lastObservedAt = Date.now()
  let lastPhase: AsyncPendingPhase | null = null

  for (;;) {
    await input.beforePoll?.()
    const status = await pollAsyncTask(input.externalId, input.userId)
    if (status.status === 'completed') {
      const url = status.resultUrl || status.imageUrl || status.videoUrl
      if (!url) {
        throw new AppError(
          'EMPTY_RESPONSE',
          `External task completed without a result URL: ${input.externalId}`,
          {
            operation: EXTERNAL_OPERATION.PROVIDER_TERMINAL_RESULT,
            details: { externalId: input.externalId },
          },
        )
      }
      return {
        url,
        status,
        ...(typeof status.actualVideoTokens === 'number' ? { actualVideoTokens: status.actualVideoTokens } : {}),
        ...(status.downloadHeaders ? { downloadHeaders: status.downloadHeaders } : {}),
      }
    }
    if (status.status === 'failed') {
      throw new ProviderTaskFailureError(input.externalId, status.failure)
    }

    const now = Date.now()
    const phase: AsyncPendingPhase = status.pendingPhase === 'queued' ? 'queued' : 'running'
    if (phase === 'queued') {
      queuedMs += now - lastObservedAt
    } else {
      runningMs += now - lastObservedAt
    }
    lastObservedAt = now
    if (lastPhase !== phase) {
      // 状态变化才 INFO；例行 pending 查询本身不再产生 INFO 日志。
      logger.info({
        action: 'async_wait.pending_phase_changed',
        message: 'external task pending phase changed',
        details: { externalId: input.externalId, phase, queuedMs, runningMs },
      })
      lastPhase = phase
    }

    if (phase === 'queued' && queuedMs > queueTimeoutMs) {
      throw new ProviderQueueTimeoutError(
        input.externalId,
        `External task queue wait timeout (${Math.round(queueTimeoutMs / 1000)}s): ${input.externalId}`,
        { queuedMs, queueTimeoutMs },
      )
    }
    if (runningMs > timeoutMs) {
      throw new AppError(
        'GENERATION_TIMEOUT',
        `External task polling timeout (${Math.round(timeoutMs / 1000)}s): ${input.externalId}`,
        { details: { externalId: input.externalId, timeoutMs, queuedMs, runningMs } },
      )
    }

    const elapsedRatio = Math.max(0, Math.min(1, runningMs / timeoutMs))
    await input.onPending?.({ elapsedRatio, phase })
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}
