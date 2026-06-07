import { describe, expect, it } from 'vitest'
import { buildLocationImagePromptCore } from '@/lib/location-image-prompt'

describe('buildLocationImagePromptCore', () => {
  it('uses natural invisible layout guidance for placement space in zh prompts', () => {
    const prompt = buildLocationImagePromptCore({
      description: '「雨夜街道」湿润石板路延伸到远处，路灯照亮墙面。',
      locale: 'zh',
    })

    expect(prompt).toContain('为后续人物落位保留清晰稳定的空间锚点')
    expect(prompt).toContain('不要画出文字标签、轮廓框、箭头、引导线、标记或人工占位图形')
    expect(prompt).toContain('不要添加非场景内的叠加元素')
    expect(prompt).toContain('场景世界里自然存在的文字可以保留')
    expect(prompt).toContain('招牌、路标、门牌')
    expect(prompt).not.toContain('固定人物位置')
  })

  it('uses natural invisible layout guidance for placement space in en prompts', () => {
    const prompt = buildLocationImagePromptCore({
      description: '[Rainy Street] Wet stone pavement extends into the distance under street lamps.',
      locale: 'en',
    })

    expect(prompt).toContain('Keep stable anchor objects and nearby usable open floor or open space visible')
    expect(prompt).toContain('do not draw labels, outlines, boxes, arrows, guide marks, or artificial placeholders')
    expect(prompt).toContain('Do not add non-diegetic overlays')
    expect(prompt).toContain('Natural in-world text on plausible scene objects')
    expect(prompt).toContain('shop signs, street signs, door numbers')
    expect(prompt).not.toContain('fixed character positions')
  })
})
