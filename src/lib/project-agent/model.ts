import type { LanguageModel } from 'ai'
import { getProviderKey, parseModelKeyStrict } from '@/lib/ai-registry/selection'
import { PLATFORM_DEFAULT_ASSISTANT_MODEL_KEY } from '@/lib/ai-registry/platform-models'
import { getDeploymentConfig, isPlatformProviderCredentialMode } from '@/lib/deployment/config'
import { getUserModelConfig } from '@/lib/config-service'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import { resolveLlmRuntimeModel } from '@/lib/ai-exec/llm-runtime'
import { createAiLanguageModel } from '@/lib/ai-exec/language-model'
import { resolveReasoningEffort } from '@/lib/ai-exec/reasoning-effort'

export const DEFAULT_PROJECT_AGENT_ASSISTANT_MODEL_KEY = PLATFORM_DEFAULT_ASSISTANT_MODEL_KEY

function normalizeProjectAgentAssistantModelKey(rawModelKey: string): string {
  const parsed = parseModelKeyStrict(rawModelKey)
  if (!parsed) {
    throw new Error(`PROJECT_AGENT_ASSISTANT_MODEL_INVALID:${rawModelKey}`)
  }
  return parsed.modelKey
}

export function resolvePlatformProjectAgentAssistantModelKey(): string {
  const rawModelKey = process.env.PLATFORM_DEFAULT_ASSISTANT_MODEL?.trim()
    || DEFAULT_PROJECT_AGENT_ASSISTANT_MODEL_KEY
  return normalizeProjectAgentAssistantModelKey(rawModelKey)
}

export async function resolveProjectAgentAssistantModelKey(userId: string): Promise<string> {
  const deployment = getDeploymentConfig()
  if (isPlatformProviderCredentialMode(deployment)) {
    return resolvePlatformProjectAgentAssistantModelKey()
  }

  const userConfig = await getUserModelConfig(userId)
  if (!userConfig.assistantModel) {
    throw new Error('PROJECT_AGENT_ASSISTANT_MODEL_NOT_CONFIGURED')
  }
  return normalizeProjectAgentAssistantModelKey(userConfig.assistantModel)
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
  const reasoningEffort = await resolveReasoningEffort({
    userId: input.userId,
    modelKey: selection.modelKey,
    purpose: 'assistant',
  })
  return {
    languageModel: createAiLanguageModel({
      providerKey,
      selection,
      providerConfig,
      executionMode: 'agent',
      reasoning: true,
      reasoningEffort,
      openRouterSessionId: input.openRouterSessionId,
    }),
  }
}
