import { describe, expect, it } from 'vitest'
import { AI_PROMPT_IDS, buildAiPrompt, buildAiPromptContent } from '@/lib/ai-prompts'
import { flattenProviderMessageContent } from '@/lib/ai-providers/shared/llm-support'

describe('ai prompt cacheable content blocks', () => {
  it('keeps rendered prompt text unchanged while marking large variables as cacheable blocks', () => {
    const variables = {
      source_document: '生成一个科幻短片',
      source_checksum: 'checksum-1',
    }
    const content = buildAiPromptContent({
      promptId: AI_PROMPT_IDS.EDIT_BIBLE_GLOBAL,
      locale: 'zh',
      variables,
      cacheVariableKeys: ['source_document'],
      minCacheChars: 1,
    })
    const rendered = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_BIBLE_GLOBAL,
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
      promptId: AI_PROMPT_IDS.EDIT_BIBLE_GLOBAL,
      locale: 'zh',
      variables: {
        source_document: '短',
        source_checksum: 'checksum-1',
      },
      cacheVariableKeys: ['source_document'],
      minCacheChars: 10,
    })

    expect(typeof content).toBe('string')
    expect(content).toContain('短')
    expect(content).not.toContain('cacheControl')
  })
})
