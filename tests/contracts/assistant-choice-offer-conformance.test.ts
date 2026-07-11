import { describe, expect, it } from 'vitest'
import {
  buildProjectAgentChoiceOffer,
  expectedReviewedResourceKind,
  fingerprintProjectAgentChoiceResource,
  parseProjectAgentChoiceOffer,
} from '@/lib/project-agent/choice-offer'
import {
  EDIT_FIRST_CHOICE_REGISTRY,
  EDIT_FIRST_CHOICE_TOOL_IDS,
  EDIT_FIRST_CHOICE_TYPES,
} from '@/lib/project-agent/edit-first-choice-tools'
import type { ProjectAgentChoiceCardDefinition } from '@/lib/project-agent/types'

function card(choiceType: (typeof EDIT_FIRST_CHOICE_TYPES)[number]): ProjectAgentChoiceCardDefinition {
  return {
    cardId: `card:${choiceType}`,
    toolCallId: `tool:${choiceType}`,
    choiceType,
    replyMode: choiceType === 'script_intake' ? 'per_group' : 'whole_card',
    title: 'Choice',
    groups: [],
    submitLabel: 'Continue',
    submit: { kind: 'submit_tool_output', decision: choiceType === 'style' ? 'select' : 'approve' },
  }
}

describe('assistant choice offer conformance', () => {
  it('registers every choice identity and required capability in one exhaustive definition', () => {
    expect(Object.keys(EDIT_FIRST_CHOICE_REGISTRY)).toEqual(EDIT_FIRST_CHOICE_TYPES)
    expect(EDIT_FIRST_CHOICE_TYPES.map((choiceType) => {
      const definition = EDIT_FIRST_CHOICE_REGISTRY[choiceType]
      return {
        choiceType: definition.choiceType,
        toolId: definition.toolId,
        exportedToolId: EDIT_FIRST_CHOICE_TOOL_IDS[choiceType],
        resourceKind: definition.reviewedResourceKind,
        offerBuilder: definition.offerBuilder.kind,
        parseDecision: typeof definition.parseDecision,
        workflowDecision: typeof definition.toWorkflowDecision,
        isEnabled: typeof definition.isEnabled,
        workflowAction: typeof definition.resolveWorkflowAction,
        resolveResource: typeof definition.resolveReviewedResource,
      }
    })).toEqual([
      expect.objectContaining({ choiceType: 'script_intake', toolId: 'request_script_intake_choice', exportedToolId: 'request_script_intake_choice', resourceKind: 'script_intake_prompt', offerBuilder: 'persisted_payload' }),
      expect.objectContaining({ choiceType: 'script_review', toolId: 'request_edit_script_review_choice', exportedToolId: 'request_edit_script_review_choice', resourceKind: 'script_review_document', offerBuilder: 'runtime' }),
      expect.objectContaining({ choiceType: 'bible_review', toolId: 'request_edit_bible_review_choice', exportedToolId: 'request_edit_bible_review_choice', resourceKind: 'bible_review_plan', offerBuilder: 'runtime' }),
      expect.objectContaining({ choiceType: 'style', toolId: 'request_edit_style_choice', exportedToolId: 'request_edit_style_choice', resourceKind: 'style_preview_set', offerBuilder: 'runtime' }),
      expect.objectContaining({ choiceType: 'asset_review', toolId: 'request_edit_asset_review_choice', exportedToolId: 'request_edit_asset_review_choice', resourceKind: 'asset_review_set', offerBuilder: 'runtime' }),
    ])
    for (const definition of Object.values(EDIT_FIRST_CHOICE_REGISTRY)) {
      expect(definition.parseDecision).toBeTypeOf('function')
      expect(definition.toWorkflowDecision).toBeTypeOf('function')
      expect(definition.isEnabled).toBeTypeOf('function')
      expect(definition.resolveWorkflowAction).toBeTypeOf('function')
      expect(definition.resolveReviewedResource).toBeTypeOf('function')
    }
  })

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
