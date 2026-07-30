import type { LanguageModel } from 'ai'
import { getProviderKey, parseModelKeyStrict } from '@/lib/ai-registry/selection'
import { PLATFORM_DEFAULT_ASSISTANT_MODEL_KEY } from '@/lib/ai-registry/platform-models'
import { getDeploymentConfig, isPlatformProviderCredentialMode } from '@/lib/deployment/config'
import { getUserModelConfig } from '@/lib/config-service'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import { resolveLlmRuntimeModel } from '@/lib/ai-exec/llm-runtime'
import { createAiLanguageModel } from '@/lib/ai-exec/language-model'
import { wrapLanguageModelWithRetry } from '@/lib/project-agent/model-stream-retry'
import {
  resolveReasoningEffort,
  type ReasoningEffortPurpose,
} from '@/lib/ai-exec/reasoning-effort'

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

/**
 * Whether this caller's prompt prefix survives long enough to justify a long
 * provider cache TTL.
 *
 * `conversation` spans user turns: the same instructions and history are read
 * again after the user reads, thinks and replies, a gap that routinely exceeds
 * the provider's short window. `one_shot` covers background Tasks that end
 * when they end — the next Task carries a different prefix, so the later read
 * never arrives and a longer TTL would only buy a higher write multiplier.
 *
 * Both callers here run the same Agents loop under the same execution mode, so
 * this cannot be inferred from the call shape and must be declared.
 */
export type ProjectAgentPromptCacheHorizon = 'conversation' | 'one_shot'

export async function resolveProjectAgentLanguageModel(input: {
  userId: string
  modelKey: string
  reasoningPurpose: ReasoningEffortPurpose
  promptCacheHorizon: ProjectAgentPromptCacheHorizon
  projectId?: string
  openRouterSessionId?: string
}): Promise<{
  languageModel: LanguageModel
}> {
  const selection = await resolveLlmRuntimeModel(input.userId, input.modelKey)
  const providerConfig = await getProviderConfig(input.userId, selection.provider)
  const providerKey = getProviderKey(selection.provider)
  const reasoningEffort = await resolveReasoningEffort({
    userId: input.userId,
    modelKey: selection.modelKey,
    purpose: input.reasoningPurpose,
    ...(input.projectId ? { projectId: input.projectId } : {}),
  })
  return {
    // Retry posture: this LanguageModel is consumed by the @openai/agents
    // aisdk adapter, which invokes doGenerate/doStream directly — the AI SDK
    // `maxRetries` wrapper (generateText/streamText) never runs here. The only
    // transport retry on this path is wrapLanguageModelWithRetry: a single,
    // logged retry for retryable failures that occur before any model output
    // was produced. Callers that do use bare generateText (e.g.
    // model-input/checkpoint-generator) must pass `maxRetries: 0` to match the ai-exec
    // sdk-runner.
    languageModel: wrapLanguageModelWithRetry(createAiLanguageModel({
      providerKey,
      selection,
      providerConfig,
      executionMode: 'agent',
      reasoning: true,
      reasoningEffort,
      ...(input.promptCacheHorizon === 'conversation' ? { promptCacheTtl: '1h' as const } : {}),
      openRouterSessionId: input.openRouterSessionId,
    })),
  }
}
