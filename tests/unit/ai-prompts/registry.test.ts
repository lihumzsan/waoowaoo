import { describe, expect, it } from 'vitest'
import { buildAiPrompt, getAiPromptTemplate, resolveAiPromptIdFromOperationId } from '@/lib/ai-prompts'
import { AI_PROMPT_IDS } from '@/lib/ai-prompts/ids'

describe('ai prompt registry', () => {
  it('maps workflow skill ids to the same unified template id', () => {
    expect(resolveAiPromptIdFromOperationId('analyze_characters')).toBe(AI_PROMPT_IDS.CHARACTER_ANALYZE)
    expect(resolveAiPromptIdFromOperationId('create_shot_plan')).toBe(AI_PROMPT_IDS.STORYBOARD_PLAN)
  })

  it('loads unified template content from the new functional directory', () => {
    const template = getAiPromptTemplate(AI_PROMPT_IDS.PROP_ANALYZE, 'zh')

    expect(template).toContain('关键剧情道具资产分析师')
    expect(template).toContain('宁缺毋滥')
  })

  it('renders placeholders through the unified prompt builder', () => {
    const prompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.CHARACTER_CREATE,
      locale: 'zh',
      variables: {
        user_input: '创建一个阴郁的老管家',
      },
    })

    expect(prompt).toContain('创建一个阴郁的老管家')
  })

  it('registers style preset design prompts in both locales', () => {
    const visualZh = getAiPromptTemplate(AI_PROMPT_IDS.DESIGN_VISUAL_STYLE_PRESET, 'zh')
    const visualEn = getAiPromptTemplate(AI_PROMPT_IDS.DESIGN_VISUAL_STYLE_PRESET, 'en')

    expect(visualZh).toContain('"detailLevel"')
    expect(visualEn).toContain('"negativePrompt"')
  })

  it('keeps Chinese canvas-visible prompt templates from requiring English prompt output', () => {
    const variantTemplate = getAiPromptTemplate(AI_PROMPT_IDS.SHOT_VARIANT_ANALYZE, 'zh')
    const videoBlockTemplate = getAiPromptTemplate(AI_PROMPT_IDS.EDIT_SCRIPT_VIDEO_PROMPT_BLOCK, 'zh')
    const storyboardDetailTemplate = getAiPromptTemplate(AI_PROMPT_IDS.STORYBOARD_REFINE_DETAIL, 'zh')
    const visualStyleTemplate = getAiPromptTemplate(AI_PROMPT_IDS.DESIGN_VISUAL_STYLE_PRESET, 'zh')

    expect(variantTemplate).toContain('所有会写入画布或给用户展示的提示词字段必须全中文')
    expect(variantTemplate).toContain('❌ video_prompt 使用英文句子（必须中文）')
    expect(variantTemplate).not.toContain('必须英文')
    expect(variantTemplate).not.toContain('POV shot of a smartphone screen')

    expect(videoBlockTemplate).toContain('字段值必须整体使用中文自然语言')
    expect(videoBlockTemplate).toContain('安静的路边公交站单镜头')
    expect(videoBlockTemplate).not.toContain('Quiet roadside bus-stop shot')
    expect(videoBlockTemplate).not.toContain('Sound effects only')

    expect(storyboardDetailTemplate).toContain('video_prompt 会显示在画布上')
    expect(visualStyleTemplate).toContain('prompt 与 negativePrompt 会拼入图片生成提示词')
  })
})
