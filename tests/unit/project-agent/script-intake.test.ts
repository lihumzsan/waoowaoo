import { describe, expect, it } from 'vitest'
import {
  buildScriptIntakeChoiceCard,
  buildScriptIntakeChoiceOfferCandidate,
  normalizeScriptIntakeChoiceBrief,
  validateScriptIntakePlannerOutput,
  type ScriptIntakePlannerOutput,
} from '@/lib/project-agent/script-intake'
import { AI_PROMPT_IDS, buildAiPrompt } from '@/lib/ai-prompts'

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
    expect(zhPrompt).toContain('目标时长')
    expect(zhPrompt).toContain('key 必须是 "targetRuntime"')
    expect(zhPrompt).toContain('时代与背景设定')
    expect(zhPrompt).toContain('主角的核心动机/欲望/目标')
    expect(zhPrompt).toContain('绝对不要超过 7 个问题')
    expect(zhPrompt).toContain('系统最多只接受 7 个')
    expect(zhPrompt).toContain('不要询问完整剧本的所有信息')

    expect(enPrompt).toContain('directly expandable creative brief')
    expect(enPrompt).toContain('Target runtime')
    expect(enPrompt).toContain('key must be "targetRuntime"')
    expect(enPrompt).toContain('era and setting')
    expect(enPrompt).toContain("the protagonist's core motivation/desire/goal")
    expect(enPrompt).toContain('Never return more than 7 questions')
    expect(enPrompt).toContain('the system accepts at most 7')
    expect(enPrompt).toContain('Do not ask for every piece of script information')
  })

  it('builds a persisted choice card from validated planner questions', () => {
    const card = buildScriptIntakeChoiceCard({
      locale: 'zh',
      toolCallId: 'tool-call-1',
      seedText: '恐怖故事',
      plan,
    })

    expect(card.choiceType).toBe('script_intake')
    expect(card.variant).toBe('confirm_or_reply')
    expect(card.autoSubmitOnReady).toBe(true)
    expect(card.groups).toHaveLength(3)
    expect(card.groups[0]?.key).toBe('targetRuntime')
    expect(card.groups[0]?.label).toBe('目标时长')
    expect(card.groups[0]?.options.map((option) => option.label)).toEqual(['1分钟', '3分钟', '5分钟', '10分钟'])
    expect(card.groups[0]?.options.some((option) => option.value === 'ai_fill')).toBe(false)
    const candidate = buildScriptIntakeChoiceOfferCandidate({
      locale: 'zh',
      toolCallId: 'tool-call-1',
      seedText: '恐怖故事',
      plan,
    })
    expect(candidate.card.cardId).toBe(card.cardId)
    expect(candidate.reviewedResource.kind).toBe('script_intake_prompt')
  })

  it('normalizes model-provided runtime questions to the fixed runtime options', () => {
    const card = buildScriptIntakeChoiceCard({
      locale: 'en',
      toolCallId: 'tool-call-1',
      seedText: 'A haunted elevator story',
      plan: {
        questions: [
          {
            key: 'duration',
            label: 'Length',
            options: [
              { value: 'short', label: 'Short', description: 'Short version.' },
              { value: 'long', label: 'Long', description: 'Long version.' },
            ],
          },
          plan.questions[0]!,
        ],
      },
    })

    expect(card.groups[0]?.key).toBe('targetRuntime')
    expect(card.groups[0]?.label).toBe('Target runtime')
    expect(card.groups[0]?.options.map((option) => option.label)).toEqual([
      '1 minute',
      '3 minutes',
      '5 minutes',
      '10 minutes',
    ])
  })

  it('keeps the intake card within seven questions when adding missing runtime', () => {
    const sevenQuestionPlan: ScriptIntakePlannerOutput = {
      questions: Array.from({ length: 7 }, (_, index) => ({
        key: `question${String(index + 1)}`,
        label: `问题${String(index + 1)}`,
        options: [
          { value: `option_a_${String(index + 1)}`, label: '选项A', description: '第一种走向。' },
          { value: `option_b_${String(index + 1)}`, label: '选项B', description: '第二种走向。' },
        ],
      })),
    }

    const card = buildScriptIntakeChoiceCard({
      locale: 'zh',
      toolCallId: 'tool-call-1',
      seedText: '恐怖故事',
      plan: sevenQuestionPlan,
    })

    expect(card.groups).toHaveLength(7)
    expect(card.groups[0]?.key).toBe('targetRuntime')
    expect(card.groups.map((group) => group.key)).not.toContain('question7')
  })

  it('does not ask target runtime again when the seed already states one', () => {
    const zhCard = buildScriptIntakeChoiceCard({
      locale: 'zh',
      toolCallId: 'tool-call-1',
      seedText: '两分钟科幻短片，民科发现超光速方法后看见过去。',
      plan,
    })
    const enCard = buildScriptIntakeChoiceCard({
      locale: 'en',
      toolCallId: 'tool-call-1',
      seedText: 'A two-minute sci-fi short about faster-than-light travel revealing the past.',
      plan,
    })

    expect(zhCard.groups.map((group) => group.key)).toEqual(['subgenre', 'pace'])
    expect(enCard.groups.map((group) => group.key)).toEqual(['subgenre', 'pace'])
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
