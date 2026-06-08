import { describe, expect, it } from 'vitest'
import {
  buildCharacterCandidatePromptInstruction,
  parseCharacterCandidatePrompts,
} from '@/lib/asset-generation/character-candidate-prompts'
import {
  appendLocationCompleteSceneRule,
  buildLocationCandidateStrategies,
  parseLocationCandidatePrompt,
} from '@/lib/asset-generation/location-candidate-prompts'

describe('asset candidate prompt builders', () => {
  it('builds one character instruction that asks for exactly three candidate prompts', () => {
    const instruction = buildCharacterCandidatePromptInstruction({
      description: '三十岁武僧，准备离开山寺。',
      locale: 'zh',
      styleBible: null,
    })

    expect(instruction).toContain('同一个角色')
    expect(instruction).toContain('三条不同的最终图片生成提示词')
    expect(instruction).toContain('给生图模型保留合理发挥空间')
    expect(instruction).toContain('只输出 JSON')
    expect(parseCharacterCandidatePrompts({
      prompts: ['身份轮廓版', '服装材质版', '分镜可用性版'],
    })).toEqual(['身份轮廓版', '服装材质版', '分镜可用性版'])
  })

  it('builds three 4:3 location strategies with distinct design emphasis', () => {
    const strategies = buildLocationCandidateStrategies({
      description: '午夜办公室只剩一排工位亮着，角落传来已故同事的键盘声。',
      locale: 'zh',
      styleBible: null,
    })

    expect(strategies.map((strategy) => strategy.id)).toEqual([
      'current_baseline',
      'narrative_core_set',
      'production_texture_set',
    ])
    expect(strategies.every((strategy) => strategy.aspectRatio === '4:3')).toBe(true)
    expect(strategies[1]?.draftInstruction).toContain('故事冲突')
    expect(strategies[2]?.draftInstruction).toContain('家具道具')
    expect(appendLocationCompleteSceneRule({
      prompt: '旧办公室空场景',
      locale: 'zh',
    })).toContain('4:3 横版画幅')
    expect(parseLocationCandidatePrompt({ prompt: '最终场景 prompt' })).toBe('最终场景 prompt')
  })
})
