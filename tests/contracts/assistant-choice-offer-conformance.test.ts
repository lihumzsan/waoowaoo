import { describe, expect, it } from 'vitest'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import {
  assertProjectAgentChoiceCommitmentsMatchCard,
  buildProjectAgentChoiceCardFromAuthoring,
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

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function collectPropertyKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectPropertyKeys(item, keys))
    return keys
  }
  if (!isRecord(value)) return keys
  if (isRecord(value.properties)) {
    Object.keys(value.properties).forEach((key) => keys.add(key))
  }
  Object.values(value).forEach((item) => collectPropertyKeys(item, keys))
  return keys
}

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
      kind: 'confirm',
      title: 'Confirm the screenplay',
      description: 'Confirm only this screenplay Resource.',
      submitLabel: 'Confirm screenplay',
      commitment: null,
      reply: {
        replyLabel: 'Request changes',
        replyPlaceholder: 'Describe screenplay changes',
        replySubmitLabel: 'Send changes',
      },
    }
    expect(projectAgentChoiceCardAuthoringSchema.safeParse(authored).success).toBe(true)
    expect(projectAgentChoiceCardAuthoringSchema.safeParse({
      ...authored,
      cardId: 'model-must-not-control-this',
    }).success).toBe(false)
  })

  it('omits absent optional option fields before the server fingerprints its canonical card', () => {
    const authoring = projectAgentChoiceCardAuthoringSchema.parse({
      kind: 'select_with_actions',
      title: 'Choose a ratio',
      description: null,
      submitLabel: 'Save ratio',
      group: {
        label: 'Ratio',
        required: true,
        presentation: 'aspect_ratio',
        options: [{
          ratio: '16:9',
          label: '16:9',
          commitment: {
            operationId: 'update_project_config',
            inputJson: JSON.stringify({ videoRatio: '16:9' }),
          },
        }],
      },
      reply: null,
    })
    const built = buildProjectAgentChoiceCardFromAuthoring({
      authoring,
      cardId: 'choice-card',
      toolCallId: 'choice-tool',
    })

    expect(built.card.groups[0]?.options[0]).toEqual({
      value: '16:9',
      label: '16:9',
    })
    expect(() => fingerprintProjectAgentChoiceSubject('none', built)).not.toThrow()
  })

  it('projects exhaustive model branches that cannot express hidden Choice combinations', () => {
    const operation = createProjectAgentOperationRegistry().request_choice
    const cardSchema = operation.toolInputSchema.properties.card
    expect(isRecord(cardSchema) && Array.isArray(cardSchema.oneOf)).toBe(true)
    if (!isRecord(cardSchema) || !Array.isArray(cardSchema.oneOf)) {
      throw new Error('request_choice card must expose kind branches')
    }
    const branches = new Map(cardSchema.oneOf.flatMap((branch) => {
      if (!isRecord(branch) || !isRecord(branch.properties)) return []
      const kind = branch.properties.kind
      if (!isRecord(kind) || typeof kind.const !== 'string') return []
      return [[kind.const, branch] as const]
    }))
    expect([...branches.keys()]).toEqual([
      'confirm',
      'select',
      'select_with_actions',
      'select_per_group_text',
    ])
    const confirmBranch = branches.get('confirm')
    expect(isRecord(confirmBranch) && isRecord(confirmBranch.properties)).toBe(true)
    if (isRecord(confirmBranch) && isRecord(confirmBranch.properties)) {
      expect(confirmBranch.properties).not.toHaveProperty('groups')
      expect(confirmBranch.properties).not.toHaveProperty('group')
    }
    const selectBranch = branches.get('select')
    expect(
      isRecord(selectBranch)
      && isRecord(selectBranch.properties)
      && isRecord(selectBranch.properties.groups)
      && selectBranch.properties.groups.minItems,
    ).toBe(1)
    const perGroupBranch = branches.get('select_per_group_text')
    expect(
      isRecord(perGroupBranch)
      && Array.isArray(perGroupBranch.required)
      && perGroupBranch.required,
    ).toEqual(expect.arrayContaining(['customTextGroup']))

    const propertyKeys = collectPropertyKeys(operation.toolInputSchema)
    for (const serverOwnedKey of ['mode', 'replyMode', 'allowCustomText', 'key', 'value', 'when', 'groupKey', 'optionValue']) {
      expect(propertyKeys, serverOwnedKey).not.toContain(serverOwnedKey)
    }
    const imageGroupBranches: JsonRecord[] = []
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit)
        return
      }
      if (!isRecord(value)) return
      if (
        isRecord(value.properties)
        && isRecord(value.properties.presentation)
        && value.properties.presentation.const === 'image'
      ) {
        imageGroupBranches.push(value)
      }
      Object.values(value).forEach(visit)
    }
    visit(cardSchema)
    expect(imageGroupBranches.length).toBeGreaterThan(0)
    for (const branch of imageGroupBranches) {
      const options = isRecord(branch.properties) ? branch.properties.options : null
      const items = isRecord(options) ? options.items : null
      expect(
        isRecord(items)
        && Array.isArray(items.required)
        && items.required,
      ).toContain('imageUrl')
    }
  })

  it('builds canonical group, option, reply, and commitment identities from structural authoring', () => {
    const authored = {
      kind: 'select_with_actions' as const,
      title: 'Choose a direction',
      description: 'Choose the current direction.',
      group: {
        label: 'Direction',
        required: true,
        presentation: 'options',
        options: [{
          label: 'Folk horror',
          description: null,
          meta: null,
          commitment: {
            operationId: 'adopt_creative_direction',
            inputJson: '{"resourceId":"resource-1"}',
          },
        }],
      },
      submitLabel: 'Confirm',
      reply: null,
    }
    expect(projectAgentChoiceCardAuthoringSchema.safeParse(authored).success).toBe(true)
    const parsed = projectAgentChoiceCardAuthoringSchema.parse(authored)
    const canonical = buildProjectAgentChoiceCardFromAuthoring({
      authoring: parsed,
      cardId: 'card-1',
      toolCallId: 'tool-1',
    })
    expect(canonical).toMatchObject({
      card: {
        mode: 'select',
        replyMode: 'none',
        groups: [{
          key: 'group_1',
          allowCustomText: false,
          options: [{ value: 'option_1', label: 'Folk horror' }],
        }],
      },
      commitments: [{
        when: { kind: 'option', groupKey: 'group_1', optionValue: 'option_1' },
        operationId: 'adopt_creative_direction',
      }],
    })
  })

  it('rejects every formerly model-visible invalid static combination at the authoring boundary', () => {
    const option = {
      label: 'First',
      description: null,
      meta: null,
    }
    const group = {
      label: 'Direction',
      required: true,
      presentation: 'options' as const,
      options: [option],
    }
    const base = {
      title: 'Current decision',
      description: null,
      submitLabel: 'Submit',
    }
    const invalid = [
      { subject: { kind: 'none' }, card: { ...base, kind: 'confirm', commitment: null, reply: null, groups: [group] } },
      { subject: { kind: 'none' }, card: { ...base, kind: 'select', groups: [], reply: null } },
      {
        subject: { kind: 'none' },
        card: {
          ...base,
          kind: 'select',
          groups: [{
            ...group,
            presentation: 'image',
          }],
          reply: null,
        },
      },
      {
        subject: { kind: 'none' },
        card: {
          ...base,
          kind: 'select',
          groups: [{
            ...group,
            options: [
              { ...option, value: 'duplicate' },
              { ...option, value: 'duplicate' },
            ],
          }],
          reply: null,
        },
      },
      {
        subject: { kind: 'none' },
        card: {
          ...base,
          kind: 'select_per_group_text',
          groups: [group],
          additionalGroups: [],
          reply: {
            replyLabel: 'Other',
            replyPlaceholder: 'Describe another direction',
            replySubmitLabel: 'Send',
          },
        },
      },
      {
        subject: { kind: 'none' },
        card: { ...base, kind: 'select', groups: [group], reply: null },
        commitments: [{
          when: { kind: 'option', groupKey: 'missing', optionValue: 'missing' },
          operationId: 'update_project_config',
          inputJson: '{"videoRatio":"16:9"}',
        }],
      },
    ]
    const operation = createProjectAgentOperationRegistry().request_choice
    for (const input of invalid) {
      expect(operation.inputSchema.safeParse(input).success, JSON.stringify(input)).toBe(false)
    }
  })

  it('preserves repeated aspect-ratio options with distinct server-owned identities', () => {
    const parsed = projectAgentChoiceCardAuthoringSchema.parse({
      kind: 'select_with_actions',
      title: 'Choose framing',
      description: null,
      submitLabel: 'Use framing',
      reply: null,
      group: {
        label: 'Framing',
        required: true,
        presentation: 'aspect_ratio',
        options: [
          {
            ratio: '16:9',
            label: 'Wide',
            description: null,
            meta: null,
            commitment: null,
          },
          {
            ratio: '16:9',
            label: 'Wide alternate',
            description: null,
            meta: null,
            commitment: {
              operationId: 'update_project_config',
              inputJson: '{"videoRatio":"16:9"}',
            },
          },
        ],
      },
    })
    const canonical = buildProjectAgentChoiceCardFromAuthoring({
      authoring: parsed,
      cardId: 'card-ratio',
      toolCallId: 'tool-ratio',
    })

    expect(canonical.card.groups[0]?.options.map((option) => option.value)).toEqual([
      '16:9',
      '32:18',
    ])
    expect(canonical.commitments).toEqual([
      expect.objectContaining({
        when: {
          kind: 'option',
          groupKey: 'group_1',
          optionValue: '32:18',
        },
      }),
    ])
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
    const cancelled = parseProjectAgentChoiceDecision({
      offer,
      response: { kind: 'cancelled' },
    })

    expect(resolveProjectAgentChoiceCommitment({ offer, decision: selected })).toEqual(commitments[0])
    expect(resolveProjectAgentChoiceCommitment({ offer, decision: freeText })).toBeNull()
    expect(cancelled).toEqual({ kind: 'cancelled' })
    expect(resolveProjectAgentChoiceCommitment({ offer, decision: cancelled })).toBeNull()
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
