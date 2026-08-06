import { createScopedLogger } from '@/lib/logging/core'
import { getErrorSpec } from '@/lib/errors/codes'
import { normalizeAnyError } from '@/lib/errors/normalize'
import type { FailureRecord } from '@/lib/errors/failure'
import {
  computeRetryDelayMs,
  type RetryPolicy,
} from './policy'

export type RetryAttemptContext = {
  readonly attempt: number
  readonly maxAttempts: number
}

export type RetryFailureInfo = RetryAttemptContext & {
  readonly error: FailureRecord
  readonly raw: unknown
  readonly nextDelayMs: number
  readonly scope: string
}

export type WithRetryInput<T> = {
  readonly run: (ctx: RetryAttemptContext) => Promise<T>
  readonly policy: RetryPolicy
  readonly scope: string
  readonly shouldRetry?: (info: RetryFailureInfo) => boolean
  readonly onAttemptFailed?: (info: RetryFailureInfo) => void | Promise<void>
}

const retryLogger = createScopedLogger({ module: 'retry' })

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function shouldRetryFailure<T>(input: WithRetryInput<T>, info: RetryFailureInfo): boolean {
  if (!getErrorSpec(info.error.code).retryable) return false
  if (info.attempt >= info.maxAttempts) return false
  if (!input.shouldRetry) return true
  return input.shouldRetry(info)
}

export async function withRetry<T>(input: WithRetryInput<T>): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(input.policy.maxAttempts))
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await input.run({ attempt, maxAttempts })
    } catch (raw: unknown) {
      const nextDelayMs = computeRetryDelayMs(input.policy, attempt)
      const normalized = normalizeAnyError(raw)
      const info: RetryFailureInfo = {
        attempt,
        maxAttempts,
        error: normalized,
        raw,
        nextDelayMs,
        scope: input.scope,
      }
      await input.onAttemptFailed?.(info)
      const retry = shouldRetryFailure(input, info)
      retryLogger[retry ? 'warn' : 'error']({
        action: retry ? 'retry.attempt_failed' : 'retry.exhausted',
        message: normalized.message,
        errorCode: normalized.code,
        retryable: getErrorSpec(normalized.code).retryable,
        details: {
          scope: input.scope,
          attempt,
          maxAttempts,
          nextDelayMs: retry ? nextDelayMs : null,
        },
        error: raw instanceof Error
          ? {
            name: raw.name,
            message: raw.message,
            stack: raw.stack,
          }
          : { message: String(raw) },
      })
      if (!retry) throw raw
      await delay(nextDelayMs)
    }
  }

  throw new Error(`RETRY_INVARIANT_EXHAUSTED:${input.scope}`)
}
