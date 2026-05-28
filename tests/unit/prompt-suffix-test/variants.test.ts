import { describe, expect, it } from 'vitest'
import {
  PROMPT_SUFFIX_TEST_VARIANTS,
  buildPromptSuffixTestPrompt,
  getPromptSuffixVariant,
} from '@/lib/prompt-suffix-test/variants'

describe('prompt suffix test variants', () => {
  it('keeps current full suffix as the longest baseline and includes simplified variants', () => {
    const current = getPromptSuffixVariant('current_full')
    const compact = getPromptSuffixVariant('compact_style')
    const noSuffix = getPromptSuffixVariant('no_suffix')

    expect(PROMPT_SUFFIX_TEST_VARIANTS.map((variant) => variant.id)).toEqual([
      'current_full',
      'compact_style',
      'visual_quality',
      'negative_only',
      'no_suffix',
    ])
    expect(current?.suffix.zh.length).toBeGreaterThan(compact?.suffix.zh.length ?? 0)
    expect(noSuffix?.suffix.zh).toBe('')
  })

  it('builds final prompts by appending suffix only when it is non-empty', () => {
    expect(buildPromptSuffixTestPrompt({
      basePrompt: '主体提示词',
      suffix: '后缀',
    })).toBe('主体提示词\n\n后缀')

    expect(buildPromptSuffixTestPrompt({
      basePrompt: '主体提示词',
      suffix: '   ',
    })).toBe('主体提示词')
  })
})
