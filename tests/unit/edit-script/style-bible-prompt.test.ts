import { describe, expect, it } from 'vitest'
import {
  appendStyleBiblePromptBlock,
  parseNullableEditScriptStyleBible,
  renderStyleBiblePromptBlock,
} from '@/lib/edit-script/style-bible-prompt'
import { buildZenStyleBibleFixture } from '../../fixtures/edit-script-style-bible'

describe('style-bible-prompt', () => {
  it('asset image usage appends the fixed visual Style Bible block only', () => {
    const styleBible = buildZenStyleBibleFixture()
    const prompt = appendStyleBiblePromptBlock({
      prompt: '深山古寺庭院资产描述',
      styleBible,
      usage: 'assetImage',
      locale: 'zh',
    })

    expect(prompt).toContain('深山古寺庭院资产描述')
    expect(prompt).toContain('系统 Style Bible 视觉要求（固定追加，必须遵守）：')
    expect(prompt).toContain('用途：资产图生成')
    expect(prompt).toContain('画面滤镜：轻微柔焦，35mm镜头，克制高光。')
    expect(prompt).toContain('负向约束：避免商业广告感，避免高反差大片感，避免炫技运镜。')
    expect(prompt).not.toContain('镜头节奏：')
    expect(prompt).not.toContain('声音正向风格：')
  })

  it('storyboard image usage includes visual and camera policies', () => {
    const block = renderStyleBiblePromptBlock({
      styleBible: buildZenStyleBibleFixture(),
      usage: 'storyboardImage',
      locale: 'zh',
    })

    expect(block).toContain('用途：分镜图生成')
    expect(block).toContain('镜头节奏：缓慢呼吸式节奏，镜头停留足够久。')
    expect(block).toContain('运镜：静态或极慢推拉，避免炫技运镜。')
    expect(block).not.toContain('声音正向风格：')
  })

  it('video usage includes visual, camera, motion, and sound policies', () => {
    const block = renderStyleBiblePromptBlock({
      styleBible: buildZenStyleBibleFixture(),
      usage: 'video',
      locale: 'zh',
    })

    expect(block).toContain('用途：最终视频生成')
    expect(block).toContain('主体运动：动作轻微、缓慢、像呼吸一样连续。')
    expect(block).toContain('声音正向风格：安静环境声，远处风声与木质细响。')
    expect(block).toContain('声音负向约束：避免史诗配乐、强鼓点、夸张音效。')
  })

  it('invalid non-null Style Bible json fails explicitly', () => {
    expect(() => parseNullableEditScriptStyleBible({ strategy: 'style_bible' }))
      .toThrow('EDIT_SCRIPT_STYLE_BIBLE_INVALID')
  })
})
