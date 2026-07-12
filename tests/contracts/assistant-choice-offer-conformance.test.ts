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
  resolveEditFirstChoiceAtomicConfirmationCommand,
} from '@/lib/project-agent/edit-first-choice-tools'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
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
        atomicConfirmation: typeof definition.resolveAtomicConfirmationCommand,
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
      expect(definition.resolveAtomicConfirmationCommand).toBeTypeOf('function')
      expect(definition.resolveReviewedResource).toBeTypeOf('function')
    }
  })

  it('maps every deterministic confirmation to one non-billable transactional Operation', () => {
    const operations = createProjectAgentOperationRegistry()
    const decisions = [
      { choiceType: 'script_review', decision: 'approve' },
      { choiceType: 'bible_review', decision: 'approve', aspectRatio: '16:9' },
      { choiceType: 'style', decision: 'select', stylePreviewId: 'style-1' },
      { choiceType: 'asset_review', decision: 'approve' },
    ] as const
    const commands = decisions.map((decision) => resolveEditFirstChoiceAtomicConfirmationCommand(decision))

    expect(commands).toEqual([
      { operationId: 'approve_script', input: {} },
      { operationId: 'confirm_bible', input: { aspectRatio: '16:9' } },
      { operationId: 'confirm_edit_style_preview', input: {} },
      { operationId: 'approve_edit_script_assets', input: {} },
    ])
    for (const command of commands) {
      if (!command) throw new Error('EXPECTED_ATOMIC_CONFIRMATION_COMMAND')
      const operation = operations[command.operationId]
      expect(operation, command.operationId).toMatchObject({
        channels: { tool: true },
        intent: 'act',
        confirmation: { kind: 'none', required: false },
        effects: {
          writes: true,
          billable: false,
          longRunning: false,
          externalSideEffects: false,
        },
      })
      expect(operation?.executeInTransaction, command.operationId).toBeTypeOf('function')
      expect(operation?.inputSchema.safeParse(command.input).success, command.operationId).toBe(true)
    }
  })

  it('keeps non-confirmation Choice decisions out of the atomic confirmation executor', () => {
    expect(resolveEditFirstChoiceAtomicConfirmationCommand({
      choiceType: 'script_intake',
      decision: 'submit',
      normalizedBrief: 'brief',
    })).toBeNull()
    expect(resolveEditFirstChoiceAtomicConfirmationCommand({
      choiceType: 'script_review',
      decision: 'revise',
      revisionNotes: 'revise script',
    })).toBeNull()
    expect(resolveEditFirstChoiceAtomicConfirmationCommand({
      choiceType: 'bible_review',
      decision: 'revise',
      revisionNotes: 'revise plan',
    })).toBeNull()
    expect(resolveEditFirstChoiceAtomicConfirmationCommand({
      choiceType: 'asset_review',
      decision: 'revise',
      revisionNotes: 'revise assets',
    })).toBeNull()
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

  it('gives every Choice a tool-only lifecycle contract instead of treating it as a generic read', () => {
    const operations = createProjectAgentOperationRegistry()
    for (const choiceType of EDIT_FIRST_CHOICE_TYPES) {
      const operation = operations[EDIT_FIRST_CHOICE_REGISTRY[choiceType].toolId]
      expect(operation, choiceType).toMatchObject({
        channels: { tool: true, api: false },
        effects: { writes: false },
        confirmation: { kind: 'none', required: false },
        agentFlow: { suspendsFor: 'choice' },
      })
      expect(operation?.execute, choiceType).toBeTypeOf('function')
      expect(operation?.executeInTransaction, choiceType).toBeUndefined()
    }
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
