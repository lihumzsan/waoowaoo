import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeAnyError } from '@/lib/errors/normalize'
import { shouldRetryTaskFailure } from '@/lib/task/retry-policy'
import {
  runWithTaskExecutionDeadline,
  TaskExecutionDeadlineExceededError,
} from '@/lib/workers/task-execution-deadline'

describe('Task attempt execution deadline', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('aborts one creative_work attempt with the canonical typed timeout', async () => {
    vi.useFakeTimers()
    const observed: { signal: AbortSignal | null } = { signal: null }
    const execution = runWithTaskExecutionDeadline({
      taskType: 'creative_work',
      executionDeadlineMs: 50,
      run: async ({ signal }) => {
        observed.signal = signal
        return await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      },
    })

    const rejection = expect(execution).rejects.toMatchObject({
      name: 'TaskExecutionDeadlineExceededError',
      code: 'GENERATION_TIMEOUT',
      message: 'CREATIVE_WORK_TIMEOUT',
      details: { taskType: 'creative_work', timeoutMs: 50 },
    })
    await vi.advanceTimersByTimeAsync(50)
    await rejection
    expect(observed.signal?.aborted).toBe(true)
    expect(observed.signal?.reason).toBeInstanceOf(TaskExecutionDeadlineExceededError)
  })

  it('does not create a deadline for task types that declare none', async () => {
    await expect(runWithTaskExecutionDeadline({
      taskType: 'creative_resource_image',
      executionDeadlineMs: null,
      run: async ({ signal, executionDeadlineMs }) => ({
        aborted: signal.aborted,
        executionDeadlineMs,
      }),
    })).resolves.toEqual({ aborted: false, executionDeadlineMs: null })
  })

  it('routes the typed timeout through the existing Task retry policy', () => {
    const normalized = normalizeAnyError(
      new TaskExecutionDeadlineExceededError('creative_work', 1_200_000),
      { context: 'worker' },
    )
    expect(normalized).toMatchObject({
      code: 'GENERATION_TIMEOUT',
      retryable: true,
      details: { taskType: 'creative_work', timeoutMs: 1_200_000 },
    })
    expect(shouldRetryTaskFailure({
      taskType: 'creative_work',
      failureClass: normalized.failureClass,
    })).toBe(true)
  })
})
