import { describe, expect, it } from 'vitest'
import {
  buildProjectAgentChoiceResponseInputItem,
  parseProjectAgentChoiceDecision,
  resolveProjectAgentChoiceCommitment,
} from '@/lib/project-agent/choice-result'
import type { ProjectAgentChoiceOffer } from '@/lib/project-agent/choice-offer'

const selectionOffer: ProjectAgentChoiceOffer = {
  card: {
    cardId: 'choice-1',
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
    operationId: 'adopt_creative_direction',
    input: {
      resourceId: 'resource-b',
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

  it('treats closing any current Choice as a canonical cancelled result without a commitment', () => {
    const decision = parseProjectAgentChoiceDecision({
      card: selectionOffer.card,
      response: { kind: 'cancelled' },
    })

    expect(decision).toEqual({ kind: 'cancelled' })
    expect(resolveProjectAgentChoiceCommitment({ offer: selectionOffer, decision })).toBeNull()
  })

  it('adds the canonical decision as user input without fabricating a tool call', () => {
    const item = buildProjectAgentChoiceResponseInputItem({
      decision: { kind: 'text', text: 'Use a quieter palette.' },
      toolCallId: 'tool-1',
      cardId: 'choice-1',
    })

    expect(item).toMatchObject({ role: 'user' })
    expect('type' in item ? item.type : undefined).not.toBe('function_call')
    expect('content' in item ? item.content : '').toContain('toolCallId=tool-1')
    expect('content' in item ? item.content : '').toContain('cardId=choice-1')
    expect('content' in item ? item.content : '').toContain(
      'decision={"kind":"text","text":"Use a quieter palette."}',
    )
  })
})
