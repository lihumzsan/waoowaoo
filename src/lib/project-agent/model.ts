import type { LanguageModel } from 'ai'
import { getProviderKey, parseModelKeyStrict } from '@/lib/ai-registry/selection'
import { PLATFORM_DEFAULT_ASSISTANT_MODEL_KEY } from '@/lib/ai-registry/platform-models'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import { resolveLlmRuntimeModel } from '@/lib/ai-exec/llm-runtime'
import { createAiLanguageModel } from '@/lib/ai-exec/language-model'

export const DEFAULT_PROJECT_AGENT_ASSISTANT_MODEL_KEY = PLATFORM_DEFAULT_ASSISTANT_MODEL_KEY

export function resolveProjectAgentAssistantModelKey(): string {
  const rawModelKey = process.env.PLATFORM_DEFAULT_ASSISTANT_MODEL?.trim()
    || DEFAULT_PROJECT_AGENT_ASSISTANT_MODEL_KEY
  const parsed = parseModelKeyStrict(rawModelKey)
  if (!parsed) {
    throw new Error(`PROJECT_AGENT_ASSISTANT_MODEL_INVALID:${rawModelKey}`)
  }
  return parsed.modelKey
}

export async function resolveProjectAgentLanguageModel(input: {
  userId: string
  assistantModelKey: string
  openRouterSessionId?: string
}): Promise<{
  languageModel: LanguageModel
}> {
  const selection = await resolveLlmRuntimeModel(input.userId, input.assistantModelKey)
  const providerConfig = await getProviderConfig(input.userId, selection.provider)
  const providerKey = getProviderKey(selection.provider)
  return {
    languageModel: createAiLanguageModel({
      providerKey,
      selection,
      providerConfig,
      openRouterSessionId: input.openRouterSessionId,
    }),
  }
}
