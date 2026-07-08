import { describe, expect, it } from 'vitest'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import {
  buildScriptIntakeChoiceCard,
  normalizeScriptIntakeChoiceBrief,
  readPersistedScriptIntakeChoiceCard,
  validateScriptIntakePlannerOutput,
  type ScriptIntakePlannerOutput,
} from '@/lib/project-agent/script-intake'
import { AI_PROMPT_IDS, buildAiPrompt } from '@/lib/ai-prompts'

function workflow(stage: EditFirstWorkflowState['stage']): EditFirstWorkflowState {
  return {
    active: true,
    stage,
    blocking: { kind: 'none', reason: null },
    nextAction: null,
    allowedOperationIds: [],
  }
}

const plan: ScriptIntakePlannerOutput = {
  questions: [
    {
      key: 'subgenre',
      label: '恐怖类型',
      options: [
        { value: 'folk_horror', label: '民俗恐怖', description: '仪式和禁忌推动恐惧。' },
        { value: 'psychological_horror', label: '心理恐怖', description: '认知和压迫感推动恐惧。' },
      ],
    },
    {
      key: 'pace',
      label: '叙事节奏',
      options: [
        { value: 'slow_burn', label: '慢热压迫', description: '逐步积累不安。' },
        { value: 'reversal_driven', label: '反转驱动', description: '用连续反转推动剧情。' },
      ],
    },
  ],
}

describe('script intake choice', () => {
  it('renders planner prompts that ask only the minimum script-readiness questions', () => {
    const zhPrompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.PROJECT_AGENT_SCRIPT_INTAKE,
      locale: 'zh',
      variables: { seed_text: '两分钟科幻短片，民科发现超光速方法后看见过去。' },
    })
    const enPrompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.PROJECT_AGENT_SCRIPT_INTAKE,
      locale: 'en',
      variables: { seed_text: 'A two-minute sci-fi short about faster-than-light travel revealing the past.' },
    })

    expect(zhPrompt).toContain('可以直接扩写的创作简报')
    expect(zhPrompt).toContain('题材/基调、主角或核心关系、核心冲突或欲望、关键转折或结局方向')
    expect(zhPrompt).toContain('绝对不要超过 6 个问题')
    expect(zhPrompt).toContain('当前系统 schema 最多只接受 5 个问题')
    expect(zhPrompt).toContain('不要询问完整剧本的所有信息')

    expect(enPrompt).toContain('directly expandable creative brief')
    expect(enPrompt).toContain('genre/tone, protagonist or core relationship, central conflict or desire, key turn or ending direction')
    expect(enPrompt).toContain('Never return more than 6 questions')
    expect(enPrompt).toContain('the current system schema accepts at most 5')
    expect(enPrompt).toContain('Do not ask for every piece of script information')
  })

  it('builds a persisted choice card from validated planner questions', () => {
    const card = buildScriptIntakeChoiceCard({
      locale: 'zh',
      workflow: workflow('ready_to_ingest_script'),
      toolCallId: 'tool-call-1',
      seedText: '恐怖故事',
      plan,
    })

    expect(card.choiceType).toBe('script_intake')
    expect(card.variant).toBe('confirm_or_reply')
    expect(card.autoSubmitOnReady).toBe(true)
    expect(card.groups).toHaveLength(2)
    expect(card.groups[0]?.options.some((option) => option.value === 'ai_fill')).toBe(false)
    expect(readPersistedScriptIntakeChoiceCard(card)?.cardId).toBe(card.cardId)
  })

  it('rejects planner questions that provide an ai_fill option', () => {
    expect(() => validateScriptIntakePlannerOutput({
      questions: [
        {
          key: 'subgenre',
          label: '恐怖类型',
          options: [
            { value: 'folk_horror', label: '民俗恐怖' },
            { value: 'ai_fill', label: '交给 AI 发挥' },
          ],
        },
        plan.questions[1]!,
      ],
    })).toThrow('SCRIPT_INTAKE_AI_FILL_OPTION_FORBIDDEN:subgenre')
  })

  it('normalizes selected options and free text into one expansion brief', () => {
    const brief = normalizeScriptIntakeChoiceBrief({
      seedText: '恐怖故事',
      output: {
        ok: true,
        decision: 'approve',
        selections: {
          subgenre: 'folk_horror',
          pace: 'slow_burn',
        },
        labels: {
          subgenreLabel: '民俗恐怖',
          paceLabel: '慢热压迫',
        },
        freeText: '主角是返乡参加葬礼的姐姐。',
      },
    })

    expect(brief).toBe([
      '恐怖故事',
      '- 民俗恐怖',
      '- 慢热压迫',
      '主角是返乡参加葬礼的姐姐。',
    ].join('\n'))
  })
})
