import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import type { AiProviderLanguageModelContext } from '@/lib/ai-providers/runtime-types'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'

export type OpenAiSdkLanguageModelOptions = {
  fetch?: typeof fetch
  headers?: Record<string, string>
}

export function createOpenAiSdkLanguageModel(
  input: AiProviderLanguageModelContext,
  options?: OpenAiSdkLanguageModelOptions,
): LanguageModel {
  const openai = createOpenAI({
    apiKey: input.providerConfig.apiKey,
    ...(input.providerConfig.baseUrl ? { baseURL: input.providerConfig.baseUrl } : {}),
    name: input.providerKey,
    ...(options?.headers ? { headers: options.headers } : {}),
    fetch: options?.fetch ?? fetchWithProviderProxy,
  })
  return openai.chat(input.selection.modelId)
}
