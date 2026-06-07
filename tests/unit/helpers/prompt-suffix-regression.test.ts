import { describe, expect, it } from 'vitest'
import {
  addCharacterPromptSuffix,
  addPropPromptSuffix,
  CHARACTER_ASSET_IMAGE_RATIO,
  CHARACTER_PROMPT_SUFFIX,
  PROP_IMAGE_RATIO,
  PROP_PROMPT_SUFFIX,
  removeCharacterPromptSuffix,
  removePropPromptSuffix,
} from '@/lib/constants'

function countOccurrences(input: string, target: string) {
  if (!target) return 0
  return input.split(target).length - 1
}

describe('character prompt suffix regression', () => {
  it('appends suffix when generating prompt', () => {
    const basePrompt = 'A brave knight in silver armor'
    const generated = addCharacterPromptSuffix(basePrompt)

    expect(generated).toContain(CHARACTER_PROMPT_SUFFIX)
    expect(generated).toContain('左侧约 40% 宽度是角色主全身英雄照')
    expect(generated).toContain('不能手持任何物品')
    expect(generated).toContain('右下约 65% 高度是 3 个横向排列的动作/语境样本')
    expect(countOccurrences(generated, CHARACTER_PROMPT_SUFFIX)).toBe(1)
  })

  it('uses a 16:9 character asset board without changing prop ratio', () => {
    expect(CHARACTER_ASSET_IMAGE_RATIO).toBe('16:9')
    expect(PROP_IMAGE_RATIO).toBe('3:2')
  })

  it('removes suffix text from prompt', () => {
    const basePrompt = 'A calm detective with short black hair'
    const withSuffix = addCharacterPromptSuffix(basePrompt)
    const removed = removeCharacterPromptSuffix(withSuffix)

    expect(removed).not.toContain(CHARACTER_PROMPT_SUFFIX)
    expect(removed).toContain(basePrompt)
  })

  it('uses suffix as full prompt when base prompt is empty', () => {
    expect(addCharacterPromptSuffix('')).toBe(CHARACTER_PROMPT_SUFFIX)
    expect(removeCharacterPromptSuffix('')).toBe('')
  })

  it('appends the prop suffix exactly once', () => {
    const basePrompt = '银质餐具套装，包含刀叉与汤匙，金属光泽冷白'
    const generated = addPropPromptSuffix(basePrompt)

    expect(generated).toContain(PROP_PROMPT_SUFFIX)
    expect(countOccurrences(generated, PROP_PROMPT_SUFFIX)).toBe(1)
  })

  it('removes the prop suffix from prompts', () => {
    const basePrompt = '黑铁长棍，两端包裹金色金属箍'
    const withSuffix = addPropPromptSuffix(basePrompt)
    const removed = removePropPromptSuffix(withSuffix)

    expect(removed).not.toContain(PROP_PROMPT_SUFFIX)
    expect(removed).toContain(basePrompt)
  })
})
