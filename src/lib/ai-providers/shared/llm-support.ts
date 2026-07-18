import type { LLMStreamKind } from '@/lib/llm-observe/types'
import type { InternalLLMStreamStepMeta } from '@/lib/llm-observe/internal-stream-context'
import {
  chatMessageHasCacheControl,
  flattenChatMessageContent,
  normalizeChatMessageContentParts,
  type ChatMessage,
  type ChatMessageContent,
  type PromptCacheControl,
  type TextContentPart,
} from '@/lib/ai-registry/message-content'
import type {
  AiLlmCallOptions,
  AiLlmStreamCallbacks,
} from '@/lib/ai-registry/types'

export type ProviderPromptCacheControl = PromptCacheControl
export type ProviderTextContentPart = TextContentPart
export type ProviderChatMessageContent = ChatMessageContent
export type ProviderChatMessage = ChatMessage

export const flattenProviderMessageContent = flattenChatMessageContent
export const normalizeProviderContentParts = normalizeChatMessageContentParts
export const providerMessageHasCacheControl = chatMessageHasCacheControl

export function resolveStreamStepMeta(options: AiLlmCallOptions): InternalLLMStreamStepMeta | undefined {
  const id = typeof options.streamStepId === 'string' ? options.streamStepId.trim() : ''
  const attempt = typeof options.streamStepAttempt === 'number' && Number.isFinite(options.streamStepAttempt)
    ? Math.max(1, Math.floor(options.streamStepAttempt))
    : null
  const title = typeof options.streamStepTitle === 'string' ? options.streamStepTitle.trim() : ''
  const index = typeof options.streamStepIndex === 'number' && Number.isFinite(options.streamStepIndex)
    ? Math.max(1, Math.floor(options.streamStepIndex))
    : null
  const total = typeof options.streamStepTotal === 'number' && Number.isFinite(options.streamStepTotal)
    ? Math.max(1, Math.floor(options.streamStepTotal))
    : null
  if (!id && !attempt && !title && !index && !total) return undefined
  return {
    ...(id ? { id } : {}),
    ...(attempt ? { attempt } : {}),
    ...(title ? { title } : {}),
    ...(index ? { index } : {}),
    ...(total ? { total: Math.max(index || 1, total) } : {}),
  }
}

export function emitStreamStage(
  callbacks: AiLlmStreamCallbacks | undefined,
  step: InternalLLMStreamStepMeta | undefined,
  stage: 'submit' | 'streaming' | 'fallback' | 'completed',
  provider?: string | null,
) {
  callbacks?.onStage?.({ stage, provider, ...(step ? { step } : {}) })
}

export function emitStreamChunk(
  callbacks: AiLlmStreamCallbacks | undefined,
  step: InternalLLMStreamStepMeta | undefined,
  chunk: {
    kind: LLMStreamKind
    delta: string
    seq: number
    lane?: string | null
  },
) {
  callbacks?.onChunk?.({ ...chunk, ...(step ? { step } : {}) })
}

export class StreamChunkTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`LLM_STREAM_TIMEOUT: No stream chunk received within ${Math.round(timeoutMs / 1000)}s`)
    this.name = 'StreamChunkTimeoutError'
  }
}

export async function* withStreamChunkTimeout<T>(
  source: AsyncIterable<T>,
  timeoutMs: number = 3 * 60 * 1000,
): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]()
  while (true) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        iterator.next(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new StreamChunkTimeoutError(timeoutMs)), timeoutMs)
          if (typeof timer === 'object' && 'unref' in timer) timer.unref()
        }),
      ])
      if (result.done) return
      yield result.value
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
