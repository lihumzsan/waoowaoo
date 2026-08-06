import {
  getExternalOperationContract,
  type ExternalOperationId,
} from '@/lib/external-operation/registry'
import { createScopedLogger } from '@/lib/logging/core'
import {
  attachFailureToThrown,
  normalizeAnyError,
} from '@/lib/errors/normalize'
import type { FailureRecord } from '@/lib/errors/failure'

export type RetryAttemptContext = {
  readonly attempt: number
  readonly maxAttempts: number
}

export type RetryFailureInfo = RetryAttemptContext & {
  readonly error: FailureRecord
  readonly raw: unknown
  readonly nextDelayMs: number
  readonly operation: ExternalOperationId
  readonly scope: string
}

export type WithRetryInput<T> = {
  readonly operation: ExternalOperationId
  readonly run: (ctx: RetryAttemptContext) => Promise<T>
  readonly scope?: string
  readonly onAttemptFailed?: (info: RetryFailureInfo) => void | Promise<void>
}

const retryLogger = createScopedLogger({ module: 'retry' })

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function retryDelayMs(operation: ExternalOperationId, attempt: number): number {
  const contract = getExternalOperationContract(operation)
  const normalizedAttempt = Math.max(1, Math.floor(attempt))
  return Math.min(
    contract.baseDelayMs * Math.pow(2, normalizedAttempt - 1),
    contract.maxDelayMs,
  )
}

export async function withRetry<T>(input: WithRetryInput<T>): Promise<T> {
  const contract = getExternalOperationContract(input.operation)
  const scope = input.scope ?? input.operation
  for (let attempt = 1; attempt <= contract.maxAttempts; attempt += 1) {
    try {
      return await input.run({ attempt, maxAttempts: contract.maxAttempts })
    } catch (raw: unknown) {
      const normalized = normalizeAnyError(raw, {
        context: {
          system: 'application',
          phase: 'external-operation',
          operation: input.operation,
        },
        operation: input.operation,
        attempts: attempt,
      })
      const failedOperation = normalized.recovery.operation ?? input.operation
      const failedContract = getExternalOperationContract(failedOperation)
      const nextDelayMs = retryDelayMs(failedOperation, attempt)
      const info: RetryFailureInfo = {
        attempt,
        maxAttempts: contract.maxAttempts,
        error: normalized,
        raw,
        nextDelayMs,
        operation: failedOperation,
        scope,
      }
      await input.onAttemptFailed?.(info)
      const retry = contract.replay === 'idempotent'
        && failedContract.replay === 'idempotent'
        && attempt < contract.maxAttempts
        && attempt < failedContract.maxAttempts
      retryLogger[retry ? 'warn' : 'error']({
        action: retry ? 'retry.attempt_failed' : 'retry.exhausted',
        message: normalized.native.message,
        errorCode: normalized.interpretation.code,
        retryable: retry,
        details: {
          operation: failedOperation,
          selectedOperation: input.operation,
          scope,
          attempt,
          maxAttempts: contract.maxAttempts,
          effect: normalized.recovery.effect,
          nextDelayMs: retry ? nextDelayMs : null,
        },
        error: raw instanceof Error
          ? { name: raw.name, message: raw.message, stack: raw.stack }
          : { message: normalized.native.message },
      })
      if (!retry) throw attachFailureToThrown(raw, normalized)
      await delay(nextDelayMs)
    }
  }

  throw new Error(`RETRY_INVARIANT_EXHAUSTED:${input.operation}`)
}
