import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PROJECT_AGENT_ASSISTANT_MODEL_KEY,
  resolveProjectAgentAssistantModelKey,
} from '@/lib/project-agent/model'

const ORIGINAL_ASSISTANT_MODEL = process.env.PLATFORM_DEFAULT_ASSISTANT_MODEL
const ORIGINAL_ANALYSIS_MODEL = process.env.PLATFORM_DEFAULT_ANALYSIS_MODEL

afterEach(() => {
  if (ORIGINAL_ASSISTANT_MODEL === undefined) {
    delete process.env.PLATFORM_DEFAULT_ASSISTANT_MODEL
  } else {
    process.env.PLATFORM_DEFAULT_ASSISTANT_MODEL = ORIGINAL_ASSISTANT_MODEL
  }
  if (ORIGINAL_ANALYSIS_MODEL === undefined) {
    delete process.env.PLATFORM_DEFAULT_ANALYSIS_MODEL
  } else {
    process.env.PLATFORM_DEFAULT_ANALYSIS_MODEL = ORIGINAL_ANALYSIS_MODEL
  }
})

describe('project agent model routing', () => {
  it('defaults the assistant model to OpenRouter GPT-5.5', () => {
    delete process.env.PLATFORM_DEFAULT_ASSISTANT_MODEL

    expect(resolveProjectAgentAssistantModelKey()).toBe('openrouter::openai/gpt-5.5')
    expect(DEFAULT_PROJECT_AGENT_ASSISTANT_MODEL_KEY).toBe('openrouter::openai/gpt-5.5')
  })

  it('uses PLATFORM_DEFAULT_ASSISTANT_MODEL without reading analysis model defaults', () => {
    process.env.PLATFORM_DEFAULT_ASSISTANT_MODEL = 'openrouter::openai/gpt-5.5'
    process.env.PLATFORM_DEFAULT_ANALYSIS_MODEL = 'openrouter::google/gemini-3.5-flash'

    expect(resolveProjectAgentAssistantModelKey()).toBe('openrouter::openai/gpt-5.5')
  })

  it('fails explicitly for invalid assistant model keys', () => {
    process.env.PLATFORM_DEFAULT_ASSISTANT_MODEL = 'openai/gpt-5.5'

    expect(() => resolveProjectAgentAssistantModelKey()).toThrow(
      'PROJECT_AGENT_ASSISTANT_MODEL_INVALID:openai/gpt-5.5',
    )
  })
})
