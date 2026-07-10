import {
  collectBooleanEnums,
  collectConfirmedProperties,
  collectNeverProperties,
  createProjectAgentOperationRegistry,
  describe,
  expect,
  it,
} from './tool-input-schema.fixture'

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

  it('hides the forbidden prompt field of generate_edit_script from the model but still rejects it at execution', () => {
    const registry = createProjectAgentOperationRegistry()
    const operation = registry.generate_edit_script
    expect(operation).toBeDefined()
    expect(Object.keys(operation.toolInputSchema.properties)).not.toContain('prompt')
    expect(operation.toolInputSchema.required).not.toContain('prompt')

    const parsed = operation.inputSchema.safeParse({
      confirmed: true,
      prompt: 'should be rejected',
      bibleId: 'bible-1',
    })
    expect(parsed.success).toBe(false)

    const parsedWithoutPrompt = operation.inputSchema.safeParse({
      confirmed: true,
      bibleId: 'bible-1',
    })
    expect(parsedWithoutPrompt.success).toBe(true)
  })

  it('exposes only user-intent fields for edit-first workflow tools', () => {
    const registry = createProjectAgentOperationRegistry()

    expect(Object.keys(registry.ingest_script.toolInputSchema.properties)).toEqual([
      'sourceKind',
      'text',
    ])
    expect(Object.keys(registry.request_script_intake_choice.toolInputSchema.properties)).toEqual([
      'seedText',
    ])
    expect(Object.keys(registry.revise_script.toolInputSchema.properties)).toEqual([
      'revisionNotes',
    ])
    expect(Object.keys(registry.revise_bible.toolInputSchema.properties)).toEqual([
      'bible',
      'beatSheet',
      'ledger',
      'emotionalCurve',
    ])
    expect(Object.keys(registry.generate_edit_style_previews.toolInputSchema.properties)).toEqual([
      'styleDirection',
    ])
    expect(Object.keys(registry.revise_edit_script_assets.toolInputSchema.properties)).toEqual([
      'revisionNotes',
      'chapterId',
    ])
    for (const operationId of [
      'generate_edit_script',
      'generate_edit_script_assets',
      'revise_edit_script_assets',
      'generate_edit_shot_execution_plan',
      'generate_edit_script_storyboard',
      'generate_episode_videos',
      'render_chapters',
    ]) {
      expect(Object.keys(registry[operationId]?.toolInputSchema.properties ?? {})).toContain('chapterId')
    }

    for (const operationId of [
      'ingest_script',
      'request_script_intake_choice',
      'revise_script',
      'generate_bible_from_script',
      'revise_bible',
      'generate_edit_style_previews',
      'generate_edit_script',
      'generate_edit_script_assets',
      'revise_edit_script_assets',
      'generate_edit_shot_execution_plan',
      'generate_edit_script_storyboard',
      'generate_episode_videos',
      'render_chapters',
    ]) {
      const properties = Object.keys(registry[operationId]?.toolInputSchema.properties ?? {})
      expect(properties).not.toContain('episodeId')
      expect(properties).not.toContain('bibleId')
      expect(properties).not.toContain('editScriptId')
      expect(properties).not.toContain('storyboardId')
      expect(properties).not.toContain('panelId')
      expect(properties).not.toContain('requirementId')
      expect(properties).not.toContain('count')
      expect(properties).not.toContain('limit')
      expect(properties).not.toContain('generationOptions')
    }
  })

  it('uses empty model-facing schemas for context-derived edit-first task submissions', () => {
    const registry = createProjectAgentOperationRegistry()
    const emptyOperationIds = [
      'get_episode_overview',
      'request_edit_script_review_choice',
      'request_edit_bible_review_choice',
      'request_edit_style_choice',
      'request_edit_asset_review_choice',
      'generate_bible_from_script',
      'generate_edit_script_storyboard_images',
      'generate_episode_bgm_score',
      'render_final_video',
    ]

    for (const operationId of emptyOperationIds) {
      const operation = registry[operationId]
      expect(operation).toBeDefined()
      expect(operation?.toolInputSchema).toEqual({
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      })
    }
  })

  it('exposes nullable chapterIds for automatic or targeted chapter planning', () => {
    const registry = createProjectAgentOperationRegistry()
    const operation = registry.plan_chapters

    expect(operation?.toolInputSchema).toEqual({
      type: 'object',
      properties: {
        chapterIds: {
          anyOf: [
            {
              type: 'array',
              items: {
                type: 'string',
                minLength: 1,
              },
              minItems: 1,
            },
            {
              type: 'null',
            },
          ],
          description: 'Pass exact chapterIds only when the user explicitly targets a subset. Pass null to plan every missing or failed chapter automatically.',
        },
      },
      required: ['chapterIds'],
      additionalProperties: false,
    })
    expect(operation?.inputSchema.safeParse({ chapterIds: null }).success).toBe(true)
  })
})
