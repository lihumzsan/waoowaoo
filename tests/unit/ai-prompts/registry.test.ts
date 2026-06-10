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

  it('loads the edit-first screenplay revision template', () => {
    const prompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY_REVISION,
      locale: 'zh',
      variables: {
        original_user_request: '做一个60秒恐怖短片',
        current_screenplay_text: '标题：《旧钟》',
        revision_instruction: '改得更克苏鲁一些',
        duration_seconds: '60',
        aspect_ratio: '16:9',
      },
    })

    expect(prompt).toContain('剧本修改模块')
    expect(prompt).toContain('标题：《旧钟》')
    expect(prompt).toContain('改得更克苏鲁一些')
    expect(prompt).toContain('16:9')
  })

  it('keeps character analysis style-aware without role or costume tiers', () => {
    const template = getAiPromptTemplate(AI_PROMPT_IDS.CHARACTER_ANALYZE, 'zh')

    expect(template).toContain('示例 1：80/90 年代现实题材')
    expect(template).toContain('示例 2：科幻外星人片')
    expect(template).toContain('示例 3：古代武侠/修行题材')
    expect(template).toContain('剧本背景与 Style Bible 如何共同影响选角')
    expect(template).not.toContain('"role_level"')
    expect(template).not.toContain('"costume_tier"')
    expect(template).not.toContain('【角色重要性 role_level】')
    expect(template).not.toContain('【服装华丽度 costume_tier】')
  })

  it('keeps Chinese canvas-visible prompt templates from requiring English prompt output', () => {
    const variantTemplate = getAiPromptTemplate(AI_PROMPT_IDS.SHOT_VARIANT_ANALYZE, 'zh')
    const videoBlockTemplate = getAiPromptTemplate(AI_PROMPT_IDS.EDIT_SCRIPT_VIDEO_PROMPT_BLOCK, 'zh')
    const storyboardDetailTemplate = getAiPromptTemplate(AI_PROMPT_IDS.STORYBOARD_REFINE_DETAIL, 'zh')

    expect(variantTemplate).toContain('所有会写入画布或给用户展示的提示词字段必须全中文')
    expect(variantTemplate).toContain('❌ video_prompt 使用英文句子（必须中文）')
    expect(variantTemplate).not.toContain('必须英文')
    expect(variantTemplate).not.toContain('POV shot of a smartphone screen')

    expect(videoBlockTemplate).toContain('字段值必须整体使用中文自然语言')
    expect(videoBlockTemplate).toContain('安静的路边公交站单镜头')
    expect(videoBlockTemplate).not.toContain('Quiet roadside bus-stop shot')
    expect(videoBlockTemplate).not.toContain('Sound effects only')

    expect(storyboardDetailTemplate).toContain('video_prompt 会显示在画布上')
  })
})
