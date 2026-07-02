import { describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors/app-error'
import { withRetry, type RetryFailureInfo, type RetryPolicy } from '@/lib/retry'

const immediatePolicy: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 0,
  maxDelayMs: 0,
}

describe('withRetry', () => {
  it('retries retryable normalized errors until the operation succeeds', async () => {
    const run = vi.fn(async () => {
      if (run.mock.calls.length < 3) {
        const error = new Error('upstream status 503') as Error & { status?: number }
        error.status = 503
        throw error
      }
      return 'ok'
    })
    const onAttemptFailed = vi.fn()

    await expect(withRetry({
      scope: 'unit:retryable',
      policy: immediatePolicy,
      run,
      onAttemptFailed,
    })).resolves.toBe('ok')

    expect(run).toHaveBeenCalledTimes(3)
    expect(onAttemptFailed).toHaveBeenCalledTimes(2)
    expect(onAttemptFailed.mock.calls[0]?.[0]).toMatchObject({
      attempt: 1,
      maxAttempts: 3,
      error: {
        code: 'EXTERNAL_ERROR',
        retryable: true,
      },
    })
  })

  it('does not retry non-retryable normalized errors', async () => {
    const original = new AppError('INSUFFICIENT_BALANCE', 'balance is not enough')
    const run = vi.fn(async () => {
      throw original
    })

    await expect(withRetry({
      scope: 'unit:non-retryable',
      policy: immediatePolicy,
      run,
    })).rejects.toBe(original)

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('throws the original error instance after retry exhaustion', async () => {
    const original = new TypeError('terminated')
    const run = vi.fn(async () => {
      throw original
    })

    await expect(withRetry({
      scope: 'unit:exhausted',
      policy: {
        ...immediatePolicy,
        maxAttempts: 2,
      },
      run,
    })).rejects.toBe(original)

    expect(run).toHaveBeenCalledTimes(2)
  })

  it('lets the caller stop retrying for an otherwise retryable failure', async () => {
    const original = new TypeError('terminated')
    const run = vi.fn(async () => {
      throw original
    })
    const shouldRetry = vi.fn((_: RetryFailureInfo) => false)

    await expect(withRetry({
      scope: 'unit:caller-stop',
      policy: immediatePolicy,
      shouldRetry,
      run,
    })).rejects.toBe(original)

    expect(run).toHaveBeenCalledTimes(1)
    expect(shouldRetry).toHaveBeenCalledTimes(1)
    const info = shouldRetry.mock.calls[0]?.[0]
    if (!info) throw new Error('expected shouldRetry call')
    expect(info.error.code).toBe('NETWORK_ERROR')
  })
})
