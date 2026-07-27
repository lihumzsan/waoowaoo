import { describe, expect, it } from 'vitest'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import {
  assertProjectAgentChoiceCommitmentsMatchCard,
  buildProjectAgentChoiceOffer,
  fingerprintProjectAgentChoiceSubject,
  parseProjectAgentChoiceDecision,
  parseProjectAgentChoiceOffer,
  projectAgentChoiceCardAuthoringSchema,
  type ProjectAgentChoiceCardDefinition,
  type ProjectAgentChoiceCommitment,
} from '@/lib/project-agent/choice-offer'
import { resolveProjectAgentChoiceCommitment } from '@/lib/project-agent/choice-result'

const REMOVED_FIXED_CHOICE_OPERATIONS = [
  'request_script_intake_choice',
  'request_edit_script_review_choice',
  'request_story_canon_review_choice',
  'request_edit_style_choice',
  'request_edit_asset_review_choice',
] as const

function selectCard(): ProjectAgentChoiceCardDefinition {
  return {
    cardId: 'server-card-1',
    toolCallId: 'tool-call-1',
    mode: 'select_or_text',
    replyMode: 'whole_card',
    title: 'Choose the current visual direction',
    description: 'This decision only adopts the selected Creative Direction.',
    groups: [{
      key: 'style',
      label: 'Style',
      required: true,
      presentation: 'options',
      allowCustomText: false,
      options: [
        { value: 'style_a', label: 'Graphic noir', description: null, imageUrl: null, meta: null },
        { value: 'style_b', label: 'Soft collage', description: null, imageUrl: null, meta: null },
      ],
    }],
    submitLabel: 'Use this style',
    replyLabel: 'Describe another direction',
    replyPlaceholder: 'Tell me what should change',
    replySubmitLabel: 'Send direction',
  }
}

function styleCommitments(): ProjectAgentChoiceCommitment[] {
  return [{
    when: { kind: 'option', groupKey: 'style', optionValue: 'style_b' },
    operationId: 'adopt_creative_direction',
    input: {
      resourceId: 'resource-b',
      revisionId: 'revision-b',
      fingerprint: 'fingerprint-b',
      expectedVersion: null,
    },
  }]
}

describe('assistant choice offer conformance', () => {
  it('exposes one generic tool-owned Choice lifecycle and removes every fixed workflow Choice', () => {
    const operations = createProjectAgentOperationRegistry()
    const suspending = Object.values(operations).filter(
      (operation) => operation.agentFlow?.suspendsFor === 'choice',
    )

    expect(suspending.map((operation) => operation.id)).toEqual(['request_choice'])
    expect(operations.request_choice).toMatchObject({
      channels: { tool: true, api: false },
      prerequisites: { episodeId: 'optional' },
      intent: 'query',
      effects: { writes: false },
      confirmation: { kind: 'none', required: false },
      agentFlow: { suspendsFor: 'choice' },
    })
    expect(operations.request_choice?.execute).toBeTypeOf('function')
    expect(Object.keys(operations.request_choice?.toolInputSchema.properties ?? {})).toEqual([
      'subject',
      'card',
      'commitments',
    ])
    const modelSurface = JSON.stringify(operations.request_choice?.toolInputSchema)
    expect(modelSurface).not.toContain('choiceType')
    expect(modelSurface).not.toContain('cardId')
    expect(modelSurface).not.toContain('toolCallId')
    for (const operationId of REMOVED_FIXED_CHOICE_OPERATIONS) {
      expect(operations[operationId], operationId).toBeUndefined()
    }
  })

  it('lets the model author all visible content but rejects model-authored server identity', () => {
    const authored = {
      mode: 'confirm_or_text',
      replyMode: 'whole_card',
      title: 'Confirm the screenplay',
      description: 'Confirm only this screenplay revision.',
      groups: [],
      submitLabel: 'Confirm screenplay',
      replyLabel: 'Request changes',
      replyPlaceholder: 'Describe screenplay changes',
      replySubmitLabel: 'Send changes',
    }
    expect(projectAgentChoiceCardAuthoringSchema.safeParse(authored).success).toBe(true)
    expect(projectAgentChoiceCardAuthoringSchema.safeParse({
      ...authored,
      cardId: 'model-must-not-control-this',
    }).success).toBe(false)
  })

  it('makes per-group custom text impossible outside per_group reply mode', () => {
    const authored = {
      mode: 'select_or_text',
      replyMode: 'whole_card',
      title: 'Choose a direction',
      description: 'Choose or describe the current direction.',
      groups: [{
        key: 'direction',
        label: 'Direction',
        required: true,
        presentation: 'options',
        allowCustomText: true,
        options: [{
          value: 'folk_horror',
          label: 'Folk horror',
          description: null,
          imageUrl: null,
          meta: null,
        }],
      }],
      submitLabel: 'Confirm',
      replyLabel: 'Other direction',
      replyPlaceholder: 'Describe another direction',
      replySubmitLabel: 'Send direction',
    }

    expect(projectAgentChoiceCardAuthoringSchema.safeParse(authored).success).toBe(false)
    expect(projectAgentChoiceCardAuthoringSchema.safeParse({
      ...authored,
      replyMode: 'per_group',
    }).success).toBe(true)
  })

  it('persists generic card, subject, commitment, run, interruption, and tool identities without choiceType', () => {
    const card = selectCard()
    const commitments = styleCommitments()
    const subject = {
      kind: 'none' as const,
      fingerprint: fingerprintProjectAgentChoiceSubject('none', { card, commitments }),
    }
    const offer = buildProjectAgentChoiceOffer({
      runId: 'run-1',
      interruptionId: 'interruption-1',
      card,
      subject,
      commitments,
    })
    const parsed = parseProjectAgentChoiceOffer(offer)

    expect(parsed).toMatchObject({
      card: {
        runId: 'run-1',
        interruptionId: 'interruption-1',
        cardId: card.cardId,
        toolCallId: card.toolCallId,
        title: card.title,
      },
      subject,
      commitments,
    })
    expect(JSON.stringify(parsed)).not.toContain('choiceType')
  })

  it('resolves at most the commitment attached to the current answer', () => {
    const card = selectCard()
    const commitments = styleCommitments()
    const offer = buildProjectAgentChoiceOffer({
      runId: 'run-1',
      interruptionId: 'interruption-1',
      card,
      subject: {
        kind: 'none',
        fingerprint: fingerprintProjectAgentChoiceSubject('none', { card, commitments }),
      },
      commitments,
    })
    const selected = parseProjectAgentChoiceDecision({
      offer,
      response: {
        kind: 'select',
        selections: [{ groupKey: 'style', kind: 'option', value: 'style_b' }],
      },
    })
    const freeText = parseProjectAgentChoiceDecision({
      offer,
      response: { kind: 'text', text: 'Make it more geometric.' },
    })

    expect(resolveProjectAgentChoiceCommitment({ offer, decision: selected })).toEqual(commitments[0])
    expect(resolveProjectAgentChoiceCommitment({ offer, decision: freeText })).toBeNull()
  })

  it('rejects commitments that are ambiguous or do not correspond to an offered current action', () => {
    const card = selectCard()
    const commitments = styleCommitments()
    expect(() => assertProjectAgentChoiceCommitmentsMatchCard({
      card,
      commitments: [
        ...commitments,
        { ...commitments[0]!, operationId: 'another_operation' },
      ],
    })).toThrow('PROJECT_AGENT_CHOICE_COMMITMENT_DUPLICATE')
    expect(() => assertProjectAgentChoiceCommitmentsMatchCard({
      card,
      commitments: [{
        ...commitments[0]!,
        when: { kind: 'option', groupKey: 'style', optionValue: 'not-offered' },
      }],
    })).toThrow('PROJECT_AGENT_CHOICE_COMMITMENT_OPTION_NOT_OFFERED')
  })

  it('limits Choice commitments to explicitly eligible transactional domain operations', () => {
    const operations = createProjectAgentOperationRegistry()
    const eligible = Object.values(operations).filter(
      (operation) => operation.choiceCommit?.enabled === true,
    )
    expect(eligible.length).toBeGreaterThan(0)
    expect(eligible.map((operation) => operation.id)).toContain('update_project_config')
    for (const operation of eligible) {
      expect(operation).toMatchObject({
        intent: 'act',
        channels: { tool: true },
        effects: {
          writes: true,
          billable: false,
          destructive: false,
          bulk: false,
          externalSideEffects: false,
          longRunning: false,
        },
        confirmation: { kind: 'none', required: false },
      })
      expect(operation.effects.overwrite).toBeTypeOf('boolean')
      expect(operation.agentFlow?.suspendsFor).toBeFalsy()
      expect(operation.executeInTransaction, operation.id).toBeTypeOf('function')
    }
  })

  it('fingerprints canonical subject content independent of object key order', () => {
    const left = fingerprintProjectAgentChoiceSubject('task_result', {
      version: 2,
      content: { b: 2, a: 1 },
    })
    const right = fingerprintProjectAgentChoiceSubject('task_result', {
      content: { a: 1, b: 2 },
      version: 2,
    })
    expect(left).toEqual(right)
  })
})
