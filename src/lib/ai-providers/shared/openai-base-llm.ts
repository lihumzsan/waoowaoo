import OpenAI from 'openai'
import { generateText, streamText, type ModelMessage } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { getCompletionParts } from '@/lib/ai-providers/shared/completion-parts'
import { buildOpenAIChatCompletion } from '@/lib/ai-providers/shared/openai-chat-completion'
import { buildAiProviderLlmResult } from '@/lib/ai-providers/shared/llm-result'
import {
  buildOpenRouterRequestOptions,
  normalizeOpenRouterSessionId,
} from '@/lib/ai-providers/openrouter/session'
import { buildOpenRouterPromptCacheRequest } from '@/lib/ai-providers/openrouter/prompt-cache'
import {
  buildReasoningAwareContent,
  completionUsageSummary,
  extractStreamDeltaParts,
  getConversationMessages,
  getSystemPrompt,
  mapReasoningEffort,
  emitStreamChunk,
  emitStreamStage,
  resolveStreamStepMeta,
  withStreamChunkTimeout,
  shouldUseOpenAIReasoningProviderOptions,
  type ProviderChatMessage,
} from '@/lib/ai-providers/shared/llm-support'
import type {
  AiProviderLlmResult,
  AiProviderLlmStreamContext,
} from '@/lib/ai-providers/runtime-types'

type AISdkStreamChunk = {
  type?: string
  text?: string
}

type OpenAIStreamWithFinal = AsyncIterable<unknown> & {
  finalChatCompletion?: () => Promise<OpenAI.Chat.Completions.ChatCompletion>
}

type OpenRouterStreamUsage = {
  promptTokens: number
  completionTokens: number
  cachedInputTokens?: number
  cacheWriteTokens?: number
  cacheHitRate?: number
  providerCostCredits?: number
}

function extractOpenRouterStreamUsage(part: unknown): OpenRouterStreamUsage | null {
  const record = part && typeof part === 'object'
    ? (part as {
      usage?: {
        prompt_tokens?: unknown
        completion_tokens?: unknown
        prompt_tokens_details?: {
          cached_tokens?: unknown
          cache_write_tokens?: unknown
        } | null
        cost?: unknown
        total_cost?: unknown
        provider_cost_credits?: unknown
      } | null
    })
    : null
  if (!record?.usage) return null
  const summary = completionUsageSummary({
    usage: record.usage as {
      prompt_tokens?: number
      completion_tokens?: number
      prompt_tokens_details?: {
        cached_tokens?: number
        cache_write_tokens?: number
      } | null
      cost?: number
      total_cost?: number
      provider_cost_credits?: number
    },
  })
  if (!summary) return null
  return summary
}

export async function runOpenAIBaseUrlLlmCompletion(input: {
  providerName: string
  providerKey: string
  modelId: string
  baseUrl: string
  apiKey: string
  messages: ProviderChatMessage[]
  temperature: number
  reasoning: boolean
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high'
  isOpenRouter?: boolean
  openRouterSessionId?: string
}): Promise<AiProviderLlmResult> {
  if (!input.isOpenRouter) {
    const aiOpenAI = createOpenAI({
      baseURL: input.baseUrl,
      apiKey: input.apiKey,
      name: input.providerName,
    })
    const isNativeOpenAIReasoning = shouldUseOpenAIReasoningProviderOptions({
      providerKey: input.providerKey,
      modelId: input.modelId,
    })
    const aiSdkProviderOptions = input.reasoning && isNativeOpenAIReasoning
      ? {
        openai: {
          reasoningEffort: mapReasoningEffort(input.reasoningEffort),
          forceReasoning: true,
        },
      }
      : undefined
    const aiSdkResult = await generateText({
      model: aiOpenAI.chat(input.modelId),
      system: getSystemPrompt(input.messages),
      messages: getConversationMessages(input.messages) as ModelMessage[],
      ...(input.reasoning ? {} : { temperature: input.temperature }),
      maxRetries: 0,
      ...(aiSdkProviderOptions ? { providerOptions: aiSdkProviderOptions } : {}),
    })
    const usage = aiSdkResult.usage || aiSdkResult.totalUsage
    const normalizedUsage = {
      promptTokens: usage?.inputTokens ?? 0,
      completionTokens: usage?.outputTokens ?? 0,
    }
    return buildAiProviderLlmResult({
      completion: buildOpenAIChatCompletion(
        input.modelId,
        buildReasoningAwareContent(aiSdkResult.text || '', aiSdkResult.reasoningText || ''),
        normalizedUsage,
      ),
      logProvider: input.providerName,
      text: aiSdkResult.text || '',
      reasoning: aiSdkResult.reasoningText || '',
      usage: normalizedUsage,
      successDetails: { engine: 'ai_sdk' },
    })
  }

  const client = new OpenAI({
    baseURL: input.baseUrl,
    apiKey: input.apiKey,
  })
  const openRouterSessionId = normalizeOpenRouterSessionId(input.openRouterSessionId)
  const extraParams: { [key: string]: unknown } = {}
  if (input.reasoning) {
    extraParams.reasoning = { effort: input.reasoningEffort }
  }
  const promptCacheRequest = buildOpenRouterPromptCacheRequest({
    modelId: input.modelId,
    messages: input.messages,
  })
  const completion = await client.chat.completions.create({
    model: input.modelId,
    messages: promptCacheRequest.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    temperature: input.temperature,
    ...(promptCacheRequest.cacheControl ? { cache_control: promptCacheRequest.cacheControl } : {}),
    ...extraParams,
  } as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, buildOpenRouterRequestOptions(openRouterSessionId))
  const normalizedCompletion = completion as OpenAI.Chat.Completions.ChatCompletion
  const completionParts = getCompletionParts(normalizedCompletion)
  return buildAiProviderLlmResult({
    completion: normalizedCompletion,
    logProvider: input.providerName,
    text: completionParts.text,
    reasoning: completionParts.reasoning,
    successDetails: {
      engine: 'openai_sdk',
      openRouterSessionId: openRouterSessionId ?? null,
      openRouterResponse: normalizedCompletion,
    },
  })
}

export async function runOpenAIBaseUrlLlmStream(input: AiProviderLlmStreamContext & {
  providerName: string
  providerKey: string
  isOpenRouter?: boolean
}): Promise<AiProviderLlmResult> {
  const stepMeta = resolveStreamStepMeta(input.options)
  if (!input.providerConfig.baseUrl) {
    throw new Error(`PROVIDER_BASE_URL_MISSING: ${input.selection.provider} (llm)`)
  }

  if (!input.isOpenRouter) {
    const aiOpenAI = createOpenAI({
      baseURL: input.providerConfig.baseUrl,
      apiKey: input.providerConfig.apiKey,
      name: input.providerName,
    })
    const isNativeOpenAIReasoning = shouldUseOpenAIReasoningProviderOptions({
      providerKey: input.providerKey,
      modelId: input.selection.modelId,
    })
    const aiSdkProviderOptions = (input.options.reasoning ?? true) && isNativeOpenAIReasoning
      ? {
        openai: {
          reasoningEffort: mapReasoningEffort(input.options.reasoningEffort || 'high'),
          forceReasoning: true,
        },
      }
      : undefined
    const useReasoning = input.options.reasoning ?? true
    const aiStreamResult = streamText({
      model: aiOpenAI.chat(input.selection.modelId),
      system: getSystemPrompt(input.messages),
      messages: getConversationMessages(input.messages),
      ...(useReasoning ? {} : { temperature: input.options.temperature ?? 0.7 }),
      maxRetries: 0,
      ...(aiSdkProviderOptions ? { providerOptions: aiSdkProviderOptions } : {}),
    })

    emitStreamStage(input.callbacks, stepMeta, 'streaming', input.providerName)
    let text = ''
    let reasoning = ''
    let seq = 1
    for await (const chunk of withStreamChunkTimeout(aiStreamResult.fullStream as AsyncIterable<AISdkStreamChunk>)) {
      if (chunk?.type === 'reasoning-delta' && typeof chunk.text === 'string' && chunk.text) {
        reasoning += chunk.text
        emitStreamChunk(input.callbacks, stepMeta, {
          kind: 'reasoning',
          delta: chunk.text,
          seq,
          lane: 'reasoning',
        })
        seq += 1
      }
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text) {
        text += chunk.text
        emitStreamChunk(input.callbacks, stepMeta, {
          kind: 'text',
          delta: chunk.text,
          seq,
          lane: 'main',
        })
        seq += 1
      }
    }

    const resolvedReasoning = await Promise.resolve(aiStreamResult.reasoningText).catch(() => reasoning)
    const resolvedText = await Promise.resolve(aiStreamResult.text).catch(() => text)
    const usage = await Promise.resolve(aiStreamResult.usage).catch(() => null)
    const completion = buildOpenAIChatCompletion(
      input.selection.modelId,
      buildReasoningAwareContent(resolvedText || text, resolvedReasoning || reasoning),
      {
        promptTokens: usage?.inputTokens ?? 0,
        completionTokens: usage?.outputTokens ?? 0,
      },
    )
    emitStreamStage(input.callbacks, stepMeta, 'completed', input.providerName)
    input.callbacks?.onComplete?.(resolvedText || text, stepMeta)
    return buildAiProviderLlmResult({
      completion,
      logProvider: input.providerName,
      text: resolvedText || text,
      reasoning: resolvedReasoning || reasoning,
      usage: {
        promptTokens: usage?.inputTokens ?? 0,
        completionTokens: usage?.outputTokens ?? 0,
      },
    })
  }

  const client = new OpenAI({
    baseURL: input.providerConfig.baseUrl,
    apiKey: input.providerConfig.apiKey,
  })
  const openRouterSessionId = normalizeOpenRouterSessionId(input.options.openRouterSessionId)
  const extraParams: { [key: string]: unknown } = {}
  if (input.options.reasoning ?? true) {
    extraParams.reasoning = { effort: input.options.reasoningEffort || 'high' }
  }
  emitStreamStage(input.callbacks, stepMeta, 'streaming', input.providerName)
  const promptCacheRequest = buildOpenRouterPromptCacheRequest({
    modelId: input.selection.modelId,
    messages: input.messages,
  })
  const stream = await client.chat.completions.create({
    model: input.selection.modelId,
    messages: promptCacheRequest.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    ...((input.options.reasoning ?? true) ? {} : { temperature: input.options.temperature ?? 0.7 }),
    stream: true,
    ...(promptCacheRequest.cacheControl ? { cache_control: promptCacheRequest.cacheControl } : {}),
    ...extraParams,
  } as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming, buildOpenRouterRequestOptions(openRouterSessionId))
  let text = ''
  let reasoning = ''
  let seq = 1
  let finalCompletion: OpenAI.Chat.Completions.ChatCompletion | null = null
  let streamUsage: OpenRouterStreamUsage | null = null
  for await (const part of withStreamChunkTimeout(stream as AsyncIterable<unknown>)) {
    streamUsage = extractOpenRouterStreamUsage(part) ?? streamUsage
    const { textDelta, reasoningDelta } = extractStreamDeltaParts(part)
    if (reasoningDelta) {
      reasoning += reasoningDelta
      emitStreamChunk(input.callbacks, stepMeta, {
        kind: 'reasoning',
        delta: reasoningDelta,
        seq,
        lane: 'reasoning',
      })
      seq += 1
    }
    if (textDelta) {
      text += textDelta
      emitStreamChunk(input.callbacks, stepMeta, {
        kind: 'text',
        delta: textDelta,
        seq,
        lane: 'main',
      })
      seq += 1
    }
  }
  const finalChatCompletionFn = (stream as OpenAIStreamWithFinal)?.finalChatCompletion
  if (typeof finalChatCompletionFn === 'function') {
    try {
      finalCompletion = await finalChatCompletionFn.call(stream)
      const finalParts = getCompletionParts(finalCompletion)
      reasoning = finalParts.reasoning || reasoning
      text = finalParts.text || text
    } catch {
      finalCompletion = null
    }
  }
  const completion = finalCompletion ?? buildOpenAIChatCompletion(
    input.selection.modelId,
    buildReasoningAwareContent(text, reasoning),
    streamUsage ?? undefined,
  )
  emitStreamStage(input.callbacks, stepMeta, 'completed', input.providerName)
  input.callbacks?.onComplete?.(text, stepMeta)
  return buildAiProviderLlmResult({
    completion,
    logProvider: input.providerName,
    text,
    reasoning,
    usage: finalCompletion ? completionUsageSummary(finalCompletion) : streamUsage,
    successDetails: {
      engine: 'openai_sdk_stream',
      openRouterSessionId: openRouterSessionId ?? null,
      openRouterResponse: finalCompletion,
    },
  })
}
