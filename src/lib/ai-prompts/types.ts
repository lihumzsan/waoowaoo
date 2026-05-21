import type { Locale } from '@/i18n/routing'
import type { AiPromptId } from './ids'

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
