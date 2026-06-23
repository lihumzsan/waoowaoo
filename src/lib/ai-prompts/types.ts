import type { Locale } from '@/i18n/routing'
import type { AiPromptId } from './ids'
import type { ProviderChatMessageContent, ProviderPromptCacheControl } from '@/lib/ai-providers/shared/llm-support'

export type AiPromptLocale = Locale
export type AiPromptVariables = Record<string, string>

export type AiPromptCatalogEntry = {
  pathStem: string
  variableKeys: readonly string[]
  operationIds?: readonly string[]
}

export type BuildAiPromptInput = {
  promptId: AiPromptId
  locale: AiPromptLocale
  variables?: AiPromptVariables
}

export type BuildAiPromptContentInput = BuildAiPromptInput & {
  cacheVariableKeys?: readonly string[]
  cacheControl?: ProviderPromptCacheControl
  minCacheChars?: number
}

export type AiPromptMessageContent = ProviderChatMessageContent
