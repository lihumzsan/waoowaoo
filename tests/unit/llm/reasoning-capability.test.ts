import { describe, expect, it } from 'vitest'
import {
  isLikelyOpenAIReasoningModel,
  shouldUseOpenAIReasoningProviderOptions,
} from '@/lib/ai-providers/shared/llm-support'

describe('llm/reasoning-capability', () => {
  it('identifies likely OpenAI reasoning model ids', () => {
    expect(isLikelyOpenAIReasoningModel('o3-mini')).toBe(true)
    expect(isLikelyOpenAIReasoningModel('gpt-5.2')).toBe(true)
    expect(isLikelyOpenAIReasoningModel('claude-sonnet-4-6')).toBe(false)
  })

  it('enables reasoning provider options for supported OpenAI-style providers', () => {
    expect(shouldUseOpenAIReasoningProviderOptions({
      providerKey: 'openrouter',
      modelId: 'gpt-5.2',
    })).toBe(true)

    expect(shouldUseOpenAIReasoningProviderOptions({
      providerKey: 'ark',
      modelId: 'gpt-5.2',
    })).toBe(true)
  })

  it('disables reasoning provider options for unsupported providers', () => {
    expect(shouldUseOpenAIReasoningProviderOptions({
      providerKey: 'unsupported-provider',
      modelId: 'gpt-5.2',
    })).toBe(false)
  })

  it('disables reasoning provider options for non-openai reasoning model ids', () => {
    expect(shouldUseOpenAIReasoningProviderOptions({
      providerKey: 'openrouter',
      modelId: 'claude-sonnet-4-6',
    })).toBe(false)
  })
})
