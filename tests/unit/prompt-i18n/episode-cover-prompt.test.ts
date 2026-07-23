import { describe, expect, it } from 'vitest'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'

describe('Episode cover image prompt', () => {
  it.each(['zh', 'en'] as const)('renders a text-free single-image contract for %s', (locale) => {
    const prompt = buildPrompt({
      promptId: (
        PROMPT_IDS as unknown as Record<string, string>
      ).NP_EPISODE_COVER_IMAGE as never,
      locale,
      variables: {
        episode_context: '{"story":"clock tower"}',
        aspect_ratio: '16:9',
        style: 'cinematic realism',
      },
    })

    expect(prompt).toContain('clock tower')
    expect(prompt).toContain('16:9')
    expect(prompt).toContain('cinematic realism')
    expect(prompt).toMatch(/不得出现任何文字|no text/i)
    expect(prompt).toMatch(/数字|digits|numbers/i)
    expect(prompt).toMatch(/logo/i)
    expect(prompt).toMatch(/水印|watermark/i)
    expect(prompt).toMatch(/拼贴|collage/i)
    expect(prompt).toMatch(/一张|exactly one/i)
  })
})
