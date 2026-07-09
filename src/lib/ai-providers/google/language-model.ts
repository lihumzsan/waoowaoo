import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { LanguageModel } from 'ai'
import type { AiProviderLanguageModelContext } from '@/lib/ai-providers/runtime-types'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'

export function createGoogleSdkLanguageModel(input: AiProviderLanguageModelContext): LanguageModel {
  const google = createGoogleGenerativeAI({
    apiKey: input.providerConfig.apiKey,
    ...(input.providerConfig.baseUrl ? { baseURL: input.providerConfig.baseUrl } : {}),
    name: input.providerKey,
    fetch: fetchWithProviderProxy,
  })
  return google.chat(input.selection.modelId)
}
