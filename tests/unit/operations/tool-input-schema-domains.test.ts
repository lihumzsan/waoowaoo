import {
  collectOptionalProperties,
  createProjectAgentOperationRegistry,
  describe,
  expect,
  it,
  readRecord,
} from './tool-input-schema.fixture'

describe('tool input schema compatibility', () => {
  it('requires an explicit chapterId for chapter replanning', () => {
    const registry = createProjectAgentOperationRegistry()
    const operation = registry.replan_chapter

    expect(operation?.toolInputSchema).toEqual({
      type: 'object',
      properties: {
        chapterId: {
          type: 'string',
          minLength: 1,
          description: 'Exact chapterId to replan. This operation cannot infer a default chapter and must not receive null.',
        },
      },
      required: ['chapterId'],
      additionalProperties: false,
    })
    expect(operation?.inputSchema.safeParse({ chapterId: 'chapter-1' }).success).toBe(true)
    expect(operation?.inputSchema.safeParse({ chapterId: null }).success).toBe(false)
  })

  it('derives structured bible revision tool schema from the execution schema', () => {
    const registry = createProjectAgentOperationRegistry()
    const operation = registry.revise_bible
    const bibleSchema = readRecord(operation?.toolInputSchema.properties.bible)
    const bibleProperties = readRecord(bibleSchema.properties)

    expect(bibleSchema.type).toEqual(['object', 'null'])
    expect(bibleSchema.additionalProperties).toBe(false)
    expect(bibleSchema.required).toContain('synopsis')
    expect(Object.keys(bibleProperties)).toEqual(expect.arrayContaining([
      'title',
      'logline',
      'synopsis',
      'characters',
      'locations',
      'worldRules',
      'styleGuide',
    ]))
    expect(bibleSchema).not.toEqual({
      anyOf: [
        { type: 'object' },
        { type: 'null' },
      ],
      description: 'Structured EditBible patch. Pass null when unchanged.',
    })
  })

  it('accepts empty execution input for context-derived BGM generation', () => {
    const registry = createProjectAgentOperationRegistry()
    const operation = registry.generate_episode_bgm_score

    expect(operation.inputSchema.safeParse({}).success).toBe(true)
  })

  it('exposes only chapterId for chapter detail reads', () => {
    const registry = createProjectAgentOperationRegistry()
    const operation = registry.get_chapter_detail

    expect(operation.toolInputSchema).toEqual({
      type: 'object',
      properties: {
        chapterId: {
          type: 'string',
          minLength: 1,
          description: 'Exact chapterId to inspect. Do not pass projectId or episodeId.',
        },
      },
      required: ['chapterId'],
      additionalProperties: false,
    })
  })

  it('accepts bible revision execution input without backfilled duration or aspect ratio', () => {
    const registry = createProjectAgentOperationRegistry()
    const operation = registry.revise_bible

    expect(operation.inputSchema.safeParse({
      revisionInstruction: 'Make the ending quieter and more ambiguous.',
    }).success).toBe(true)
  })

  it('does not expose system-managed video model fields in model-facing video tool schemas', () => {
    const registry = createProjectAgentOperationRegistry()
    const operationIds = [
      'generate_panel_video',
      'generate_episode_videos',
      'generate_video_group',
      'generate_episode_video_groups',
      'generate_episode_videos_auto',
      'generate_asset_reference_video',
      'generate_episode_asset_reference_videos',
    ]

    for (const operationId of operationIds) {
      const operation = registry[operationId]
      expect(operation).toBeDefined()
      expect(Object.keys(operation.toolInputSchema.properties)).not.toContain('videoModel')
      expect(Object.keys(operation.toolInputSchema.properties)).not.toContain('groupVideoModel')
      expect(operation.toolInputSchema.required).not.toContain('videoModel')
      expect(operation.toolInputSchema.required).not.toContain('groupVideoModel')
    }
  })

  it('makes every model-facing tool property required for OpenAI strict schema conversion', () => {
    const registry = createProjectAgentOperationRegistry()
    const violations: Array<{ id: string; path: string }> = []
    for (const operation of Object.values(registry)) {
      if (!operation.channels.tool) continue
      const paths: string[] = []
      collectOptionalProperties(operation.toolInputSchema, paths)
      for (const path of paths) {
        violations.push({ id: operation.id, path })
      }
    }
    expect(violations).toEqual([])
  })
})
