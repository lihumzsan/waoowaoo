import { describe, expect, it } from 'vitest'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import {
  buildScriptIntakeChoiceCard,
  normalizeScriptIntakeChoiceBrief,
  readPersistedScriptIntakeChoiceCard,
  validateScriptIntakePlannerOutput,
  type ScriptIntakePlannerOutput,
} from '@/lib/project-agent/script-intake'

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
        { value: 'ai_fill', label: '交给 AI 发挥', description: '由系统补全。' },
      ],
    },
    {
      key: 'pace',
      label: '叙事节奏',
      options: [
        { value: 'slow_burn', label: '慢热压迫', description: '逐步积累不安。' },
        { value: 'ai_fill', label: '交给 AI 发挥', description: '由系统补全。' },
      ],
    },
  ],
}

describe('script intake choice', () => {
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
    expect(card.groups).toHaveLength(2)
    expect(card.groups[0]?.options.some((option) => option.value === 'ai_fill')).toBe(true)
    expect(readPersistedScriptIntakeChoiceCard(card)?.cardId).toBe(card.cardId)
  })

  it('rejects planner questions that do not provide an ai_fill option', () => {
    expect(() => validateScriptIntakePlannerOutput({
      questions: [
        {
          key: 'subgenre',
          label: '恐怖类型',
          options: [
            { value: 'folk_horror', label: '民俗恐怖' },
            { value: 'psychological', label: '心理恐怖' },
          ],
        },
        plan.questions[1]!,
      ],
    })).toThrow('SCRIPT_INTAKE_AI_FILL_OPTION_REQUIRED:subgenre')
  })

  it('normalizes selected options and free text into one expansion brief', () => {
    const brief = normalizeScriptIntakeChoiceBrief({
      seedText: '恐怖故事',
      output: {
        ok: true,
        decision: 'approve',
        selections: {
          subgenre: 'folk_horror',
          pace: 'ai_fill',
        },
        labels: {
          subgenreLabel: '民俗恐怖',
          paceLabel: '交给 AI 发挥',
        },
        freeText: '主角是返乡参加葬礼的姐姐。',
      },
    })

    expect(brief).toBe([
      '恐怖故事',
      '- 民俗恐怖',
      '主角是返乡参加葬礼的姐姐。',
    ].join('\n'))
  })
})
