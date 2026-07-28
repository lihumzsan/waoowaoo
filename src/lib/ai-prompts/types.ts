import type { AiPromptId } from './ids'
import type { ChatMessageContent, PromptCacheControl } from '@/lib/ai-registry/message-content'

export type AiPromptVariables = Record<string, string>

export type AiPromptCatalogEntry = {
  pathStem: string
  variableKeys: readonly string[]
  operationIds?: readonly string[]
}

export type BuildAiPromptInput = {
  promptId: AiPromptId
  variables?: AiPromptVariables
}

export type BuildAiPromptContentInput = BuildAiPromptInput & {
  cacheVariableKeys?: readonly string[]
  cacheControl?: PromptCacheControl
  minCacheChars?: number
}

export type AiPromptMessageContent = ChatMessageContent
