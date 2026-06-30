import { describe, expect, it } from 'vitest'
import { buildAiPrompt, getAiPromptTemplate } from '@/lib/ai-prompts'
import { AI_PROMPT_IDS } from '@/lib/ai-prompts/ids'

describe('ai prompt registry', () => {
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

  it('loads the screenplay revision template', () => {
    const prompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY_REVISION,
      locale: 'zh',
      variables: {
        original_user_request: '做一个60秒恐怖短片',
        current_screenplay_text: '标题：《旧钟》',
        revision_instruction: '改得更克苏鲁一些',
        duration_guidance: '中时长档位，约 60 秒。允许完整起承转合。',
        aspect_ratio: '16:9',
      },
    })

    expect(prompt).toContain('短片剧本改写 AI')
    expect(prompt).toContain('标题：《旧钟》')
    expect(prompt).toContain('改得更克苏鲁一些')
    expect(prompt).toContain('16:9')
  })

  it('keeps Chinese canvas-visible prompt templates from requiring English prompt output', () => {
    const variantTemplate = getAiPromptTemplate(AI_PROMPT_IDS.SHOT_VARIANT_ANALYZE, 'zh')
    const executionTemplate = getAiPromptTemplate(AI_PROMPT_IDS.EDIT_SCRIPT_SHOT_EXECUTION_PLAN, 'zh')

    expect(variantTemplate).toContain('所有会写入画布或给用户展示的提示词字段必须全中文')
    expect(variantTemplate).toContain('❌ video_prompt 使用英文句子（必须中文）')
    expect(variantTemplate).not.toContain('必须英文')
    expect(variantTemplate).not.toContain('POV shot of a smartphone screen')

    expect(executionTemplate).toContain('ShotExecutionPlan')
    expect(executionTemplate).toContain('camera.lighting')
    expect(executionTemplate).toContain('blocking.axis')
    expect(executionTemplate).toContain('continuousVideoPrompt')
    expect(executionTemplate).toContain('只返回 JSON')
  })
})
