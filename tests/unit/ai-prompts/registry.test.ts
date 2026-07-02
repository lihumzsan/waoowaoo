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

  it('renders edit structure generation segment duration constraints', () => {
    const prompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_STRUCTURE,
      locale: 'zh',
      variables: {
        user_request: '做一个恐怖短片',
        screenplay_text: '林小雨听到门外异响。',
        duration_guidance: '短时长档位，约 30 秒。',
        generation_segment_max_duration_seconds: '15',
        aspect_ratio: '16:9',
        style_bible_json: '{}',
      },
    })

    expect(prompt).toContain('不得超过 15 秒')
    expect(prompt).toContain('逐段累加 durationSec')
  })

  it('keeps Chinese canvas-visible prompt templates from requiring English prompt output', () => {
    const executionTemplate = getAiPromptTemplate(AI_PROMPT_IDS.EDIT_SCRIPT_SHOT_EXECUTION_PLAN, 'zh')

    expect(executionTemplate).toContain('ShotExecutionPlan')
    expect(executionTemplate).toContain('camera.lighting')
    expect(executionTemplate).toContain('blocking.axis')
    expect(executionTemplate).toContain('continuousVideoPrompt')
    expect(executionTemplate).toContain('blocking.characters[] 中的每一个人物对象都必须输出且只输出')
    expect(executionTemplate).toContain('即使 visibility 是 `hidden`、`occluded` 或 `offscreen`')
    expect(executionTemplate).toContain('blocking.objects[] 中的每一个物体对象都必须输出且只输出')
    expect(executionTemplate).toContain('禁止给物体输出 facing、eyeline、visibility、role 或任何其他字段')
    expect(executionTemplate).toContain('只返回 JSON')
  })

  it('keeps English shot execution prompt strict about character and object fields', () => {
    const executionTemplate = getAiPromptTemplate(AI_PROMPT_IDS.EDIT_SCRIPT_SHOT_EXECUTION_PLAN, 'en')

    expect(executionTemplate).toContain('Every item in `blocking.characters[]` must output exactly these six fields')
    expect(executionTemplate).toContain('Even when visibility is `hidden`, `occluded`, or `offscreen`')
    expect(executionTemplate).toContain('Every item in `blocking.objects[]` must output exactly these three fields')
    expect(executionTemplate).toContain('Do not output `facing`, `eyeline`, `visibility`, `role`, or any other field for objects')
  })
})
