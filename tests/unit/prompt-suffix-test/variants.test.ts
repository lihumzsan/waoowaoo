import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROMPT_LENGTH_TEST_SOURCE_TEXT,
  DEFAULT_PROMPT_LENGTH_TEST_STORYBOARD_JSON,
  DEFAULT_PROMPT_LENGTH_TEST_STYLE_BIBLE_TEXT,
  DEFAULT_PROMPT_LENGTH_TEST_STYLE_TEXT,
  PROMPT_SUFFIX_TEST_VARIANTS,
  buildPromptLengthTestPrompt,
  getPromptSuffixVariant,
} from '@/lib/prompt-suffix-test/variants'
import type { PromptSuffixVariantId } from '@/lib/prompt-suffix-test/variants'

describe('prompt suffix test variants', () => {
  const promptInput = {
    aspectRatio: '16:9',
    storyboardJson: DEFAULT_PROMPT_LENGTH_TEST_STORYBOARD_JSON.zh,
    sourceText: DEFAULT_PROMPT_LENGTH_TEST_SOURCE_TEXT.zh,
    styleText: DEFAULT_PROMPT_LENGTH_TEST_STYLE_TEXT.zh,
    styleBibleText: DEFAULT_PROMPT_LENGTH_TEST_STYLE_BIBLE_TEXT.zh,
  }

  function build(variantId: PromptSuffixVariantId): string {
    return buildPromptLengthTestPrompt({
      variantId,
      locale: 'zh',
      promptInput,
    })
  }

  it('keeps the current full prompt as the longest baseline and includes shorter full-prompt variants', () => {
    const current = getPromptSuffixVariant('current_full')
    const medium = getPromptSuffixVariant('medium_structured')
    const minimal = getPromptSuffixVariant('json_minimal')

    expect(PROMPT_SUFFIX_TEST_VARIANTS.map((variant) => variant.id)).toEqual([
      'current_full',
      'medium_structured',
      'short_structured',
      'json_direct',
      'json_minimal',
    ])
    expect(current?.title.zh).toBe('当前完整版本')
    expect(medium?.title.zh).toBe('中等压缩版本')
    expect(minimal?.title.zh).toBe('最短 JSON 版本')
    expect(build('current_full').length).toBeGreaterThan(build('medium_structured').length)
    expect(build('medium_structured').length).toBeGreaterThan(build('json_minimal').length)
  })

  it('builds the full baseline around the raw storyboard json input', () => {
    const current = build('current_full')

    expect(current).toContain('【分镜数据】')
    expect(current).toContain(DEFAULT_PROMPT_LENGTH_TEST_STORYBOARD_JSON.zh)
    expect(current).toContain('系统 Style Bible 视觉要求')
  })

  it('removes non-image fields from compressed variants instead of resending the full json', () => {
    const short = build('short_structured')
    const direct = build('json_direct')

    expect(short).toContain('严格按裁剪 JSON 执行')
    expect(short).toContain('"image_prompt"')
    expect(short).toContain('"shot_blocking"')
    expect(short).toContain('"spatial_profile"')
    expect(short).not.toContain('"video_prompt"')
    expect(short).not.toContain('"photography_rules"')
    expect(short).not.toContain(DEFAULT_PROMPT_LENGTH_TEST_STORYBOARD_JSON.zh)
    expect(direct).toContain('"image_prompt"')
    expect(direct).toContain('"shot_blocking"')
    expect(direct).not.toContain('"spatial_profile"')
    expect(direct).not.toContain('系统 Style Bible 视觉要求')
  })

  it('uses only panel image_prompt for the minimal variant', () => {
    const minimal = build('json_minimal')

    expect(minimal).toContain('单张电影分镜图，写实东方自然主义')
    expect(minimal).toContain('禁止文字，禁止字幕，禁止编号，禁止水印，禁止logo。')
    expect(minimal).not.toContain('{')
    expect(minimal).not.toContain('shot_blocking')
    expect(minimal).not.toContain('系统 Style Bible 视觉要求')
  })

  it('fails explicitly when storyboard json is empty', () => {
    expect(() => buildPromptLengthTestPrompt({
      variantId: 'current_full',
      locale: 'zh',
      promptInput: {
        ...promptInput,
        storyboardJson: '   ',
      },
    })).toThrow('PROMPT_SUFFIX_TEST_STORYBOARD_JSON_REQUIRED')
  })
})
