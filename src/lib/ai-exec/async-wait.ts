import { AppError } from '@/lib/errors/app-error'
import { RETRY_POLICY, withRetry } from '@/lib/retry'
import { getWorkerExternalPollMs, getWorkerExternalTimeoutMs } from '@/lib/workers/runtime-config'
import { pollAsyncTask } from './async-poll'
import { ProviderPermanentFailureError, ProviderTerminalFailureError } from './provider-errors'

export type AsyncProviderResult = {
  readonly url: string
  readonly status: Awaited<ReturnType<typeof pollAsyncTask>>
  readonly actualVideoTokens?: number
  readonly downloadHeaders?: Record<string, string>
}

export async function waitForAsyncProviderResult(input: {
  readonly externalId: string
  readonly userId: string
  readonly timeoutMs?: number
  readonly intervalMs?: number
  readonly beforePoll?: () => Promise<void>
  readonly onPending?: (elapsedRatio: number) => Promise<void>
}): Promise<AsyncProviderResult> {
  const timeoutMs = input.timeoutMs ?? getWorkerExternalTimeoutMs()
  const intervalMs = input.intervalMs ?? getWorkerExternalPollMs()
  const startAt = Date.now()

  while (Date.now() - startAt <= timeoutMs) {
    await input.beforePoll?.()
    const status = await withRetry({
      scope: `media:poll:${input.externalId}`,
      policy: RETRY_POLICY.mediaPoll,
      run: async () => await pollAsyncTask(input.externalId, input.userId),
    })
    if (status.status === 'completed') {
      const url = status.resultUrl || status.imageUrl || status.videoUrl
      if (!url) {
        throw new ProviderTerminalFailureError(
          input.externalId,
          `External task completed without a result URL: ${input.externalId}`,
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
      const message = status.error || `External task failed: ${input.externalId}`
      if (status.failureDisposition === 'retryable') {
        throw new ProviderTerminalFailureError(input.externalId, message)
      }
      if (status.failureDisposition === 'permanent') {
        throw new ProviderPermanentFailureError(input.externalId, message)
      }
      throw new Error(`ASYNC_PROVIDER_FAILURE_DISPOSITION_REQUIRED:${input.externalId}`)
    }

    const elapsedRatio = Math.max(0, Math.min(1, (Date.now() - startAt) / timeoutMs))
    await input.onPending?.(elapsedRatio)
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new AppError(
    'GENERATION_TIMEOUT',
    `External task polling timeout (${Math.round(timeoutMs / 1000)}s): ${input.externalId}`,
    { details: { externalId: input.externalId, timeoutMs } },
  )
}
