import { describe, expect, it } from 'vitest'
import { AI_PROMPT_IDS, buildAiPrompt, buildAiPromptContent } from '@/lib/ai-prompts'
import { flattenProviderMessageContent } from '@/lib/ai-providers/shared/llm-support'

describe('ai prompt cacheable content blocks', () => {
  it('keeps rendered prompt text unchanged while marking large variables as cacheable blocks', () => {
    const variables = {
      user_request: '生成一个科幻短片',
      duration_guidance: '约 60 秒',
      aspect_ratio: '16:9',
    }
    const content = buildAiPromptContent({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY,
      locale: 'zh',
      variables,
      cacheVariableKeys: ['user_request'],
      minCacheChars: 1,
    })
    const rendered = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY,
      locale: 'zh',
      variables,
    })

    expect(flattenProviderMessageContent(content)).toBe(rendered)
    expect(Array.isArray(content)).toBe(true)
    expect(content).toEqual(expect.arrayContaining([
      {
        type: 'text',
        text: '生成一个科幻短片',
        cacheControl: { type: 'ephemeral', ttl: '1h' },
      },
    ]))
  })

  it('returns a plain string when no variable crosses the cache threshold', () => {
    const content = buildAiPromptContent({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY,
      locale: 'zh',
      variables: {
        user_request: '短',
        duration_guidance: '约 60 秒',
        aspect_ratio: '16:9',
      },
      cacheVariableKeys: ['user_request'],
      minCacheChars: 10,
    })

    expect(typeof content).toBe('string')
    expect(content).toContain('短')
    expect(content).not.toContain('cacheControl')
  })
})
