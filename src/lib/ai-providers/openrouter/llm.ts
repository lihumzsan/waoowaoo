import OpenAI from 'openai'
import { runOpenAIBaseUrlLlmCompletion, runOpenAIBaseUrlLlmStream } from '@/lib/ai-providers/shared/openai-base-llm'
import { getCompletionParts } from '@/lib/ai-providers/shared/completion-parts'
import { buildAiProviderLlmResult } from '@/lib/ai-providers/shared/llm-result'
import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import {
  buildOpenRouterRequestOptions,
  normalizeOpenRouterSessionId,
} from '@/lib/ai-providers/openrouter/session'
import type {
  AiProviderLlmResult,
  AiProviderLlmStreamContext,
  AiProviderVisionExecutionContext,
} from '@/lib/ai-providers/runtime-types'
import type { ProviderChatMessage } from '@/lib/ai-providers/shared/llm-support'

type OpenRouterVisionContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export async function runOpenRouterLlmCompletion(input: {
  modelId: string
  providerConfig: {
    apiKey: string
    baseUrl?: string
  }
  messages: ProviderChatMessage[]
  temperature: number
  reasoning: boolean
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high'
  maxRetries: number
  openRouterSessionId?: string
}): Promise<AiProviderLlmResult> {
  if (!input.providerConfig.baseUrl) {
    throw new Error('PROVIDER_BASE_URL_MISSING: openrouter (llm)')
  }
  return await runOpenAIBaseUrlLlmCompletion({
    providerName: 'openrouter',
    providerKey: 'openrouter',
    modelId: input.modelId,
    baseUrl: input.providerConfig.baseUrl,
    apiKey: input.providerConfig.apiKey,
    messages: input.messages,
    temperature: input.temperature,
    reasoning: input.reasoning,
    reasoningEffort: input.reasoningEffort,
    maxRetries: input.maxRetries,
    isOpenRouter: true,
    openRouterSessionId: input.openRouterSessionId,
  })
}

export async function runOpenRouterLlmStream(input: AiProviderLlmStreamContext): Promise<AiProviderLlmResult> {
  return await runOpenAIBaseUrlLlmStream({
    ...input,
    providerName: 'openrouter',
    providerKey: 'openrouter',
    isOpenRouter: true,
  })
}

export async function runOpenRouterVisionCompletion(input: AiProviderVisionExecutionContext): Promise<AiProviderLlmResult> {
  if (!input.providerConfig.baseUrl) {
    throw new Error('PROVIDER_BASE_URL_MISSING: openrouter (vision)')
  }

  const content: OpenRouterVisionContentPart[] = []
  if (input.textPrompt.trim()) {
    content.push({ type: 'text', text: input.textPrompt })
  }
  for (const imageUrl of input.imageUrls) {
    const normalizedImageUrl = await normalizeToBase64ForGeneration(imageUrl)
    content.push({ type: 'image_url', image_url: { url: normalizedImageUrl } })
  }

  if (content.length === 0) {
    throw new Error('OPENROUTER_VISION_INPUT_EMPTY')
  }

  const client = new OpenAI({
    baseURL: input.providerConfig.baseUrl,
    apiKey: input.providerConfig.apiKey,
  })
  const openRouterSessionId = normalizeOpenRouterSessionId(input.options?.openRouterSessionId)
  const completion = await client.chat.completions.create({
    model: input.selection.modelId,
    messages: [{
      role: 'user',
      content,
    }],
    temperature: input.temperature,
  }, buildOpenRouterRequestOptions(openRouterSessionId))
  const normalizedCompletion = completion as OpenAI.Chat.Completions.ChatCompletion
  const completionParts = getCompletionParts(normalizedCompletion)
  return buildAiProviderLlmResult({
    completion: normalizedCompletion,
    logProvider: 'openrouter',
    text: completionParts.text,
    reasoning: completionParts.reasoning,
    successDetails: {
      engine: 'openai_sdk_vision',
      openRouterSessionId: openRouterSessionId ?? null,
      openRouterResponse: normalizedCompletion,
    },
  })
}
