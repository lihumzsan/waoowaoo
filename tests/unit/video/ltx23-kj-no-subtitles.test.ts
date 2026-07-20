import { describe, expect, it } from 'vitest'

import { sanitizeLtx23KjNoSubtitlesPrompt } from '@/lib/video-duration/ltx23-kj-no-subtitles'

describe('sanitizeLtx23KjNoSubtitlesPrompt', () => {
  it('removes literal Chinese dialogue while preserving visible speaking motion and relay structure', () => {
    const result = sanitizeLtx23KjNoSubtitlesPrompt([
      'GLOBAL: 年轻男子穿着“深蓝色”外套，站在窗边。',
      'LOCAL 1: 他转向镜头，说道：“你终于来了。”',
      'LOCAL 2: 他继续说“我们现在出发”，同时抬起右手。',
      'LOCAL 3: 他闭上嘴并缓慢放下右手。',
      'LENGTHS: 45, 105, 75',
    ].join('\n'))

    expect(result).toContain('GLOBAL:')
    expect(result).toContain('LOCAL 1:')
    expect(result).toContain('LOCAL 3:')
    expect(result).toContain('LENGTHS: 45, 105, 75')
    expect(result).toContain('“深蓝色”')
    expect(result).toContain('嘴唇')
    expect(result).toContain('抬起右手')
    expect(result).not.toContain('你终于来了')
    expect(result).not.toContain('我们现在出发')
  })

  it('removes literal English speech while preserving the visible performance', () => {
    const result = sanitizeLtx23KjNoSubtitlesPrompt([
      'GLOBAL: The same woman in a "navy blue" coat remains by the window.',
      'LOCAL 1: She whispers, "Do not look back," while glancing toward the door.',
      'LOCAL 2: She says "Follow me now" and raises her right hand.',
      'LOCAL 3: Her mouth closes and her hand settles.',
      'LENGTHS: 45, 105, 75',
    ].join('\n'))

    expect(result).toContain('"navy blue"')
    expect(result).toMatch(/mouth|lip/i)
    expect(result).toContain('raises her right hand')
    expect(result).not.toContain('Do not look back')
    expect(result).not.toContain('Follow me now')
  })

  it('removes exact transcript constraints produced by the shared dialogue context', () => {
    const result = sanitizeLtx23KjNoSubtitlesPrompt([
      'GLOBAL: The doctor remains seated behind the desk.',
      'LOCAL 1: The doctor faces forward and speaks.',
      'The spoken dialogue must match exactly "Hello Chen Ji, I need to ask you some questions."',
      'LENGTHS: 75, 75, 75',
    ].join('\n'))

    expect(result).toContain('The doctor faces forward and speaks')
    expect(result).not.toContain('Hello Chen Ji')
    expect(result).not.toMatch(/spoken dialogue must match exactly/i)
  })

  it('removes positive text-artifact prohibition clauses without deleting adjacent action', () => {
    const result = sanitizeLtx23KjNoSubtitlesPrompt([
      'GLOBAL: The same young man remains beside the glowing table.',
      'LOCAL 1: He bends closer to the table. Do not add subtitles, captions, readable text, or watermarks.',
      'LOCAL 2: He traces the light with one finger; avoid Chinese characters and text overlays.',
      'LOCAL 3: He looks up and settles.',
      'LENGTHS: 45, 105, 75',
    ].join('\n'))

    expect(result).toContain('He bends closer to the table')
    expect(result).toContain('He traces the light with one finger')
    expect(result).not.toMatch(/subtitles?|captions?|readable text|watermarks?|Chinese characters|text overlays?/i)
  })

  it('is idempotent for an already sanitized structured prompt', () => {
    const prompt = [
      'GLOBAL: The same young man remains beside the glowing table.',
      'LOCAL 1: He turns toward camera and speaks naturally with rhythmic lip movement.',
      'LOCAL 2: He raises one hand while maintaining eye contact.',
      'LOCAL 3: His mouth closes and the hand settles.',
      'LENGTHS: 45, 105, 75',
    ].join('\n')

    expect(sanitizeLtx23KjNoSubtitlesPrompt(sanitizeLtx23KjNoSubtitlesPrompt(prompt))).toBe(prompt)
  })
})
