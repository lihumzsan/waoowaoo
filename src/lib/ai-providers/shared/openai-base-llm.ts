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
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import {
  buildReasoningAwareContent,
  completionUsageSummary,
  extractStreamDeltaParts,
  getConversationMessages,
  getSystemPrompt,
  mapReasoningEffort,
  emitStreamChunk,
  emitChunkedText,
  emitStreamStage,
  resolveUnstreamedFinalText,
  resolveStreamStepMeta,
  withStreamChunkTimeout,
  shouldUseOpenAIReasoningProviderOptions,
  type ProviderChatMessage,
} from '@/lib/ai-providers/shared/llm-support'
import type {
  AiProviderLlmResult,
  AiProviderLlmStreamContext,
} from '@/lib/ai-providers/runtime-types'
import { AppError } from '@/lib/errors/app-error'

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

function extractOpenRouterFinishReason(part: unknown): string | null {
  if (!part || typeof part !== 'object') return null
  const choices = (part as { choices?: Array<{ finish_reason?: unknown }> }).choices
  const value = choices?.[0]?.finish_reason
  return typeof value === 'string' && value.trim() ? value.trim() : null
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
      fetch: fetchWithProviderProxy,
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
    fetch: fetchWithProviderProxy,
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
  const finishReason = normalizedCompletion.choices[0]?.finish_reason ?? null
  if (finishReason === 'length') {
    throw new AppError('MODEL_OUTPUT_TRUNCATED', 'OpenRouter output reached the token limit', {
      details: { rawReason: finishReason, textChars: completionParts.text.length, reasoningChars: completionParts.reasoning.length },
      provider: 'openrouter',
    })
  }
  if (!completionParts.text.trim()) {
    throw new AppError('EMPTY_RESPONSE', 'OpenRouter returned no response body', {
      details: { rawReason: finishReason, textChars: 0, reasoningChars: completionParts.reasoning.length },
      provider: 'openrouter',
    })
  }
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
      fetch: fetchWithProviderProxy,
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
    fetch: fetchWithProviderProxy,
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
  let streamFinishReason: string | null = null
  for await (const part of withStreamChunkTimeout(stream as AsyncIterable<unknown>)) {
    streamUsage = extractOpenRouterStreamUsage(part) ?? streamUsage
    streamFinishReason = extractOpenRouterFinishReason(part) ?? streamFinishReason
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
      const finalText = finalParts.text || text
      seq = emitChunkedText(
        resolveUnstreamedFinalText(text, finalText),
        input.callbacks,
        'text',
        seq,
        stepMeta,
      )
      text = finalText
    } catch (error: unknown) {
      throw new AppError('EXTERNAL_ERROR', 'OpenRouter final completion could not be read', {
        details: { failure: 'final_completion_read_failed' },
        provider: 'openrouter',
        cause: error,
      })
    }
  }
  const rawFinishReason = finalCompletion?.choices[0]?.finish_reason ?? streamFinishReason
  if (!rawFinishReason) {
    throw new AppError('EXTERNAL_ERROR', 'OpenRouter stream ended without a final completion', {
      details: { failure: 'abnormal_eof', textChars: text.length, reasoningChars: reasoning.length },
      provider: 'openrouter',
    })
  }
  if (rawFinishReason === 'length') {
    throw new AppError('MODEL_OUTPUT_TRUNCATED', 'OpenRouter output reached the token limit', {
      details: { rawReason: rawFinishReason, textChars: text.length, reasoningChars: reasoning.length },
      provider: 'openrouter',
    })
  }
  if (rawFinishReason === 'content_filter') {
    throw new AppError('SENSITIVE_CONTENT', 'OpenRouter blocked the response for safety reasons', {
      details: { rawReason: rawFinishReason },
      provider: 'openrouter',
    })
  }
  if (!text.trim()) {
    throw new AppError('EMPTY_RESPONSE', 'OpenRouter returned reasoning without a response body', {
      details: { rawReason: rawFinishReason, textChars: 0, reasoningChars: reasoning.length },
      provider: 'openrouter',
    })
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
    termination: {
      kind: 'normal',
      rawReason: rawFinishReason,
    },
    usage: finalCompletion ? completionUsageSummary(finalCompletion) : streamUsage,
    successDetails: {
      engine: 'openai_sdk_stream',
      openRouterSessionId: openRouterSessionId ?? null,
      openRouterResponse: finalCompletion,
    },
  })
}
