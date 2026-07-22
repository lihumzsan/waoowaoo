import { describe, expect, it } from 'vitest'
import {
  buildProjectAgentChoiceResultFromDecision,
  parseProjectAgentChoiceDecision,
  resolveProjectAgentChoiceCommitment,
} from '@/lib/project-agent/choice-result'
import type { ProjectAgentChoiceOffer } from '@/lib/project-agent/choice-offer'

const selectionOffer: ProjectAgentChoiceOffer = {
  card: {
    cardId: 'choice-1',
    runId: 'run-1',
    interruptionId: 'interruption-1',
    toolCallId: 'tool-1',
    mode: 'select_or_text',
    replyMode: 'whole_card',
    title: '选择当前输出方向',
    groups: [{
      key: 'direction',
      label: '方向',
      required: true,
      presentation: 'options',
      options: [
        { value: 'a', label: '方向 A' },
        { value: 'b', label: '方向 B' },
      ],
    }],
    submitLabel: '确认选择',
    replyLabel: '补充其他方向',
    replyPlaceholder: '描述你希望的方向',
    replySubmitLabel: '提交文字',
  },
  subject: { kind: 'none', fingerprint: '0'.repeat(64) },
  commitments: [{
    when: { kind: 'option', groupKey: 'direction', optionValue: 'b' },
    operationId: 'adopt_style_bible',
    input: {
      resourceId: 'resource-b',
      revisionId: 'revision-b',
      fingerprint: 'f'.repeat(64),
    },
  }],
}

describe('generic Project Agent Choice decisions', () => {
  it('accepts only offered option values and resolves the exact frozen commitment', () => {
    const decision = parseProjectAgentChoiceDecision({
      card: selectionOffer.card,
      response: {
        kind: 'select',
        selections: [{ groupKey: 'direction', kind: 'option', value: 'b' }],
      },
    })

    expect(decision).toEqual({
      kind: 'select',
      selections: [{ groupKey: 'direction', kind: 'option', value: 'b' }],
    })
    expect(resolveProjectAgentChoiceCommitment({ offer: selectionOffer, decision })).toEqual(
      selectionOffer.commitments[0],
    )
  })

  it('rejects values that were not in the persisted offer', () => {
    expect(() => parseProjectAgentChoiceDecision({
      card: selectionOffer.card,
      response: {
        kind: 'select',
        selections: [{ groupKey: 'direction', kind: 'option', value: 'invented' }],
      },
    })).toThrow('PROJECT_AGENT_CHOICE_SELECTION_NOT_OFFERED:direction:invented')
  })

  it('serializes only the canonical current decision into the resumed model segment', () => {
    const result = buildProjectAgentChoiceResultFromDecision({
      decision: { kind: 'text', text: 'Use a quieter palette.' },
      toolCallId: 'tool-1',
    })

    expect(result.decision).toEqual({ kind: 'text', text: 'Use a quieter palette.' })
    expect(result.inputItems).toHaveLength(2)
    expect(result.inputItems[0]).toMatchObject({
      type: 'function_call',
      callId: 'tool-1',
      name: 'request_choice',
    })
    expect(result.inputItems[1]).toMatchObject({
      type: 'function_call_result',
      callId: 'tool-1',
      name: 'request_choice',
      output: {
        type: 'text',
        text: JSON.stringify({
          ok: true,
          decision: { kind: 'text', text: 'Use a quieter palette.' },
        }),
      },
    })
  })
})
