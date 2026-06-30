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
    const executionTemplate = getAiPromptTemplate(AI_PROMPT_IDS.EDIT_SCRIPT_SHOT_EXECUTION_PLAN, 'zh')

    expect(executionTemplate).toContain('ShotExecutionPlan')
    expect(executionTemplate).toContain('camera.lighting')
    expect(executionTemplate).toContain('blocking.axis')
    expect(executionTemplate).toContain('continuousVideoPrompt')
    expect(executionTemplate).toContain('只返回 JSON')
  })
})
