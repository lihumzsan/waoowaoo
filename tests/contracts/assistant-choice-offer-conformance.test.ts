import { describe, expect, it } from 'vitest'
import {
  buildProjectAgentChoiceOffer,
  expectedReviewedResourceKind,
  fingerprintProjectAgentChoiceResource,
  parseProjectAgentChoiceOffer,
} from '@/lib/project-agent/choice-offer'
import { EDIT_FIRST_CHOICE_TYPES } from '@/lib/project-agent/edit-first-choice-tools'
import type { ProjectAgentChoiceCardDefinition } from '@/lib/project-agent/types'

function card(choiceType: (typeof EDIT_FIRST_CHOICE_TYPES)[number]): ProjectAgentChoiceCardDefinition {
  return {
    cardId: `card:${choiceType}`,
    toolCallId: `tool:${choiceType}`,
    choiceType,
    title: 'Choice',
    groups: [],
    submitLabel: 'Continue',
    submit: { kind: 'submit_tool_output' },
  }
}

describe('assistant choice offer conformance', () => {
  it('binds every registered choice type to one explicit reviewed-resource kind', () => {
    expect(EDIT_FIRST_CHOICE_TYPES.map((choiceType) => [
      choiceType,
      expectedReviewedResourceKind(choiceType),
    ])).toEqual([
      ['script_intake', 'script_intake_prompt'],
      ['script_review', 'script_review_document'],
      ['bible_review', 'bible_review_plan'],
      ['style', 'style_preview_set'],
      ['asset_review', 'asset_review_set'],
    ])
  })

  it.each(EDIT_FIRST_CHOICE_TYPES)('requires persisted run, interruption, card, and tool identity for %s', (choiceType) => {
    const definition = card(choiceType)
    const offer = buildProjectAgentChoiceOffer({
      runId: 'run-1',
      interruptionId: 'interruption-1',
      card: definition,
      reviewedResource: fingerprintProjectAgentChoiceResource({
        kind: expectedReviewedResourceKind(choiceType),
        snapshot: { version: 1 },
      }),
    })

    expect(parseProjectAgentChoiceOffer(offer).card).toMatchObject({
      runId: 'run-1',
      interruptionId: 'interruption-1',
      cardId: definition.cardId,
      toolCallId: definition.toolCallId,
      choiceType,
    })
  })

  it('rejects a card without a persisted interruption identity', () => {
    const offer = buildProjectAgentChoiceOffer({
      runId: 'run-1',
      interruptionId: 'interruption-1',
      card: card('script_review'),
      reviewedResource: fingerprintProjectAgentChoiceResource({
        kind: 'script_review_document',
        snapshot: { version: 1 },
      }),
    })
    const invalid = {
      ...offer,
      card: {
        ...offer.card,
        interruptionId: null,
      },
    }
    expect(() => parseProjectAgentChoiceOffer(invalid)).toThrow('PROJECT_AGENT_CHOICE_OFFER_INVALID')
  })

  it('fingerprints canonical resource content independent of object key order', () => {
    const left = fingerprintProjectAgentChoiceResource({
      kind: 'bible_review_plan',
      snapshot: { version: 2, content: { b: 2, a: 1 } },
    })
    const right = fingerprintProjectAgentChoiceResource({
      kind: 'bible_review_plan',
      snapshot: { content: { a: 1, b: 2 }, version: 2 },
    })
    expect(left).toEqual(right)
  })
})
