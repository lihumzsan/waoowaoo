import type { LanguageModel } from 'ai'
import { normalizeAnyError } from '@/lib/errors/normalize'
import type { NormalizedError } from '@/lib/errors/types'
import { createScopedLogger } from '@/lib/logging/core'

/**
 * Single automatic retry for the assistant LanguageModel.
 *
 * The @openai/agents aisdk adapter calls doStream/doGenerate directly, so no
 * AI SDK `maxRetries` transport wrapper exists on this path. Providers such as
 * OpenRouter surface upstream 429s as an in-stream `{type:'error'}` part
 * within ~1s of stream start; the adapter rethrows that raw payload and the
 * whole Run fails.
 *
 * Safety boundary: a stream attempt is only retried while it has not produced
 * any output-bearing part yet. Once anything beyond the neutral prelude
 * (stream-start / response-metadata) reached the consumer, partial output is
 * already flowing downstream and a retry would duplicate content — the error
 * is then surfaced untouched. doGenerate has no partial-output window, so a
 * retryable failure retries the whole call once.
 *
 * This is a transport-attempt retry below the Run lifecycle (AGENTS.md §8:
 * one failed attempt is not the business-final failure); it never converts
 * outcomes, never retries non-retryable errors (per normalizeAnyError) and
 * never retries after the caller's abort signal fired.
 */

const logger = createScopedLogger({ module: 'project-agent.model' })

const RETRY_BACKOFF_BASE_MS = 2_000
const RETRY_BACKOFF_JITTER_MS = 500

/**
 * Parts that carry no model output. A retried attempt re-emits its own
 * prelude, so the first attempt's prelude is held back until we know whether
 * the attempt survives past it. Everything else (text/reasoning/tool parts,
 * finish, raw passthrough chunks) closes the retry gate.
 */
const PRELUDE_STREAM_PART_TYPES: ReadonlySet<string> = new Set([
  'stream-start',
  'response-metadata',
])

type StreamPartLike = { type: string; error?: unknown }

type StreamResultLike = { stream: ReadableStream<StreamPartLike> }

type RetryTrigger = 'stream_start_rejected' | 'stream_error_part' | 'stream_rejected' | 'generate_rejected'

function readAbortSignal(options: unknown): AbortSignal | undefined {
  if (!options || typeof options !== 'object') return undefined
  const candidate = (options as { abortSignal?: unknown }).abortSignal
  return candidate instanceof AbortSignal ? candidate : undefined
}

/**
 * Returns the normalized error when the failed first attempt is eligible for
 * the single retry; null leaves the original failure path fully untouched.
 */
function evaluateRetryEligibility(error: unknown, abortSignal: AbortSignal | undefined): NormalizedError | null {
  if (abortSignal?.aborted) return null
  const normalized = normalizeAnyError(error)
  return normalized.retryable ? normalized : null
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Logs the retry decision and waits out the backoff. Rethrows the original
 * error when the caller aborted while waiting, so cancellation semantics are
 * preserved through the backoff window.
 */
async function waitBeforeRetry(input: {
  normalized: NormalizedError
  trigger: RetryTrigger
  originalError: unknown
  abortSignal: AbortSignal | undefined
}): Promise<void> {
  const delayMs = RETRY_BACKOFF_BASE_MS + Math.floor(Math.random() * RETRY_BACKOFF_JITTER_MS)
  logger.warn({
    message: 'Retrying assistant model call once after a retryable pre-content failure',
    action: 'llm.stream.retried',
    errorCode: input.normalized.code,
    retryable: true,
    details: {
      attempt: 1,
      maxAttempts: 2,
      delayMs,
      trigger: input.trigger,
    },
  })
  await wait(delayMs)
  if (input.abortSignal?.aborted) throw input.originalError
}

/**
 * Wraps the first attempt's stream with the pre-content retry gate.
 *
 * Neutral prelude parts are buffered (bounded: at most a handful of metadata
 * parts) instead of forwarded, so a retried second attempt starts cleanly
 * without the consumer seeing a duplicated prelude. The first output-bearing
 * part flushes the buffer and switches to plain passthrough. A pre-content
 * retryable failure — whether delivered as an in-stream error part or as a
 * stream rejection — swaps in one fresh doStream attempt, which then runs
 * unguarded: its errors surface exactly as they would without this wrapper.
 */
function createRetryGatedStream(
  firstStream: ReadableStream<StreamPartLike>,
  retryInvoke: () => Promise<StreamResultLike>,
  abortSignal: AbortSignal | undefined,
): ReadableStream<StreamPartLike> {
  let reader = firstStream.getReader()
  let prelude: StreamPartLike[] = []
  // Once true the gate is closed: parts pass through untouched and no retry
  // can happen anymore (either content was seen or the retry was spent).
  let settled = false

  const flushPrelude = (controller: ReadableStreamDefaultController<StreamPartLike>): void => {
    for (const part of prelude) controller.enqueue(part)
    prelude = []
  }

  const switchToSecondAttempt = async (
    normalized: NormalizedError,
    trigger: RetryTrigger,
    originalError: unknown,
  ): Promise<void> => {
    settled = true
    prelude = []
    await waitBeforeRetry({ normalized, trigger, originalError, abortSignal })
    try {
      await reader.cancel()
    } catch {
      // The failed first stream may already be errored; nothing to release.
    }
    const second = await retryInvoke()
    reader = second.stream.getReader()
  }

  return new ReadableStream<StreamPartLike>({
    async pull(controller) {
      // Loop so that buffering a prelude part still makes progress within one
      // pull instead of returning without enqueueing anything.
      for (;;) {
        let result: ReadableStreamReadResult<StreamPartLike>
        try {
          result = await reader.read()
        } catch (error) {
          if (!settled) {
            const normalized = evaluateRetryEligibility(error, abortSignal)
            if (normalized) {
              await switchToSecondAttempt(normalized, 'stream_rejected', error)
              continue
            }
          }
          throw error
        }
        if (result.done) {
          flushPrelude(controller)
          controller.close()
          return
        }
        const part = result.value
        if (settled) {
          controller.enqueue(part)
          return
        }
        if (PRELUDE_STREAM_PART_TYPES.has(part.type)) {
          prelude.push(part)
          continue
        }
        if (part.type === 'error') {
          const normalized = evaluateRetryEligibility(part.error, abortSignal)
          if (normalized) {
            await switchToSecondAttempt(normalized, 'stream_error_part', part.error)
            continue
          }
        }
        // First output-bearing part (or a non-retryable error part): flush the
        // held prelude and pass everything through unchanged from here on.
        settled = true
        flushPrelude(controller)
        controller.enqueue(part)
        return
      }
    },
    async cancel(reason) {
      await reader.cancel(reason)
    },
  })
}

/**
 * Wraps a LanguageModel so doStream/doGenerate retry exactly once on a
 * retryable failure that occurs before any model output was produced. All
 * other behavior — part order, part contents, non-retryable failures,
 * post-content failures, abort handling — is byte-identical passthrough.
 */
export function wrapLanguageModelWithRetry(model: LanguageModel): LanguageModel {
  if (typeof model === 'string') return model

  const doStream = async (options: unknown): Promise<StreamResultLike> => {
    const abortSignal = readAbortSignal(options)
    const invoke = (): Promise<StreamResultLike> =>
      Promise.resolve(model.doStream(options as never)) as Promise<StreamResultLike>
    let first: StreamResultLike
    try {
      first = await invoke()
    } catch (error) {
      const normalized = evaluateRetryEligibility(error, abortSignal)
      if (!normalized) throw error
      await waitBeforeRetry({ normalized, trigger: 'stream_start_rejected', originalError: error, abortSignal })
      // The single retry is spent: the second attempt runs unguarded.
      return await invoke()
    }
    return {
      ...first,
      stream: createRetryGatedStream(first.stream, invoke, abortSignal),
    }
  }

  const doGenerate = async (options: unknown): Promise<unknown> => {
    const abortSignal = readAbortSignal(options)
    const invoke = (): Promise<unknown> => Promise.resolve(model.doGenerate(options as never))
    try {
      return await invoke()
    } catch (error) {
      const normalized = evaluateRetryEligibility(error, abortSignal)
      if (!normalized) throw error
      await waitBeforeRetry({ normalized, trigger: 'generate_rejected', originalError: error, abortSignal })
      return await invoke()
    }
  }

  // Boundary cast: the wrapper preserves the exact V2/V3 method signatures at
  // runtime (options pass through untouched, results are the provider's own
  // objects with only the stream replaced by a same-typed gated stream), but
  // TypeScript cannot relate the structural retry types to the V2|V3 union.
  return {
    ...model,
    doStream,
    doGenerate,
  } as unknown as LanguageModel
}
