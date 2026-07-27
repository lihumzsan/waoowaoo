import {
  collectBooleanEnums,
  collectConfirmedProperties,
  collectNeverProperties,
  createProjectAgentOperationRegistry,
  describe,
  expect,
  it,
} from './tool-input-schema.fixture'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

describe('tool input schema compatibility', () => {
  it('does not emit boolean enum values in tool parameter schemas', () => {
    const registry = createProjectAgentOperationRegistry()
    const violations: Array<{ id: string; enum: unknown[] }> = []
    for (const operation of Object.values(registry)) {
      if (!operation.channels.tool) continue
      const enums: unknown[][] = []
      collectBooleanEnums(operation.toolInputSchema, enums)
      for (const e of enums) {
        violations.push({ id: operation.id, enum: e })
      }
    }
    expect(violations).toEqual([])
  })

  it('does not expose internal confirmation fields in model-facing tool schemas', () => {
    const registry = createProjectAgentOperationRegistry()
    const violations: Array<{ id: string; path: string }> = []
    for (const operation of Object.values(registry)) {
      if (!operation.channels.tool) continue
      const paths: string[] = []
      collectConfirmedProperties(operation.toolInputSchema, paths)
      for (const path of paths) {
        violations.push({ id: operation.id, path })
      }
    }
    expect(violations).toEqual([])
  })

  it('never exposes z.never() guard fields in model-facing tool schemas', () => {
    const registry = createProjectAgentOperationRegistry()
    const violations: Array<{ id: string; path: string }> = []
    for (const operation of Object.values(registry)) {
      if (!operation.channels.tool) continue
      const paths: string[] = []
      collectNeverProperties(operation.toolInputSchema, paths)
      for (const path of paths) {
        violations.push({ id: operation.id, path })
      }
    }
    expect(violations).toEqual([])
  })

  it('exposes one generic Choice authoring contract instead of workflow-specific cards', () => {
    const registry = createProjectAgentOperationRegistry()
    const operation = registry.request_choice

    expect(operation).toBeDefined()
    expect(Object.keys(operation.toolInputSchema.properties)).toEqual([
      'subject',
      'card',
      'commitments',
    ])
    expect(operation.toolInputSchema.required).toEqual(['subject', 'card', 'commitments'])
    expect(operation.inputSchema.safeParse({
      subject: { kind: 'none' },
      card: {
        mode: 'confirm',
        replyMode: 'none',
        title: 'Use this direction?',
        groups: [],
        submitLabel: 'Confirm',
        replyLabel: null,
        replyPlaceholder: null,
        replySubmitLabel: null,
      },
      commitments: [],
    }).success).toBe(true)

    const cardSchema = operation.toolInputSchema.properties.card
    expect(isRecord(cardSchema) && Array.isArray(cardSchema.oneOf)).toBe(true)
    if (!isRecord(cardSchema) || !Array.isArray(cardSchema.oneOf)) {
      throw new Error('request_choice card must expose replyMode branches')
    }
    const branches = new Map(cardSchema.oneOf.flatMap((branch) => {
      if (!isRecord(branch) || !isRecord(branch.properties)) return []
      const replyMode = branch.properties.replyMode
      if (!isRecord(replyMode) || typeof replyMode.const !== 'string') return []
      return [[replyMode.const, branch] as const]
    }))
    expect([...branches.keys()]).toEqual(['none', 'whole_card', 'per_group'])
    for (const replyMode of ['none', 'whole_card', 'per_group']) {
      const branch = branches.get(replyMode)
      expect(branch?.required).toEqual(expect.arrayContaining([
        'replyLabel',
        'replyPlaceholder',
        'replySubmitLabel',
      ]))
      if (!branch || !isRecord(branch.properties)) continue
      for (const key of ['replyLabel', 'replyPlaceholder', 'replySubmitLabel']) {
        const property = branch.properties[key]
        expect(isRecord(property) ? property.type : undefined)
          .toBe(replyMode === 'none' ? 'null' : 'string')
      }
    }
  })
})
