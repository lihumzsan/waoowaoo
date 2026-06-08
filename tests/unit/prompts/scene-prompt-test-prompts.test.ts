import { describe, expect, it } from 'vitest'
import { buildScenePromptTestStrategies } from '@/lib/scene-prompt-test/prompts'

describe('scene prompt test prompts', () => {
  it('keeps the baseline as control and gives each new strategy a distinct example emphasis', () => {
    const strategies = buildScenePromptTestStrategies({
      sceneInput: '午夜办公室只剩一个程序员，角落传来已经过劳死同事的键盘声。',
      locale: 'zh',
    })

    expect(strategies.map((strategy) => strategy.id)).toEqual([
      'current_baseline',
      'story_core_single',
      'spatial_wide',
      'multi_view_board',
    ])

    const storyCore = strategies.find((strategy) => strategy.id === 'story_core_single')
    const productionTexture = strategies.find((strategy) => strategy.id === 'spatial_wide')
    const blockingWide = strategies.find((strategy) => strategy.id === 'multi_view_board')

    expect(storyCore?.draftInstruction).toContain('示例输入：财阀继承人在家族公司地下档案库发现父亲伪造事故记录')
    expect(storyCore?.draftInstruction).toContain('地点选择为家族公司地下档案库而不是普通办公室')
    expect(storyCore?.draftInstruction).toContain('通过封闭结构、深处唯一光点、负空间和秩序化档案墙暗示')

    expect(productionTexture?.draftInstruction).toContain('最终 prompt 必须比基准更细')
    expect(productionTexture?.draftInstruction).toContain('高度洁白、极度对称、干净到不安的空间美术')
    expect(productionTexture?.draftInstruction).toContain('关键物品、空间布局、装修形态、表面材质、使用痕迹')

    expect(blockingWide?.draftInstruction).toContain('21:9 空场景资产图')
    expect(blockingWide?.draftInstruction).toContain('中央中景保留大面积无遮挡湿地面')
    expect(blockingWide?.draftInstruction).toContain('入口/出口、反打方向和肩后空间')
  })
})
