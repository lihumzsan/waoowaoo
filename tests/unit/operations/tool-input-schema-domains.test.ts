import {
  collectOptionalProperties,
  createProjectAgentOperationRegistry,
  describe,
  expect,
  it,
} from './tool-input-schema.fixture'

describe('tool input schema domain conformance', () => {
  it('accepts exact Resources for current Story Canon adoption', () => {
    const operation = createProjectAgentOperationRegistry().adopt_story_canon

    expect(operation.inputSchema.safeParse({
      screenplay: {
        resourceId: 'r_AAAAAAAAAAAAAAAAAAAAAA',
      },
      storyCanon: {
        resourceId: 'r_BBBBBBBBBBBBBBBBBBBBBB',
      },
      expectedVersion: null,
    }).success).toBe(true)
    expect(operation.inputSchema.safeParse({
      storyCanon: {
        resourceId: 'r_BBBBBBBBBBBBBBBBBBBBBB',
      },
    }).success).toBe(false)
  })

  it('requires exact screenplay and chapter-plan Resources when adopting Chapter units', () => {
    const operation = createProjectAgentOperationRegistry().adopt_chapters

    expect(operation.inputSchema.safeParse({
      screenplay: {
        resourceId: 'r_AAAAAAAAAAAAAAAAAAAAAA',
      },
      chapterPlan: {
        resourceId: 'r_CCCCCCCCCCCCCCCCCCCCCC',
      },
    }).success).toBe(true)
    expect(operation.inputSchema.safeParse({}).success).toBe(false)
  })

  it('makes every model-facing tool property required for OpenAI strict schema conversion', () => {
    const registry = createProjectAgentOperationRegistry()
    const violations: Array<{ id: string; path: string }> = []
    for (const operation of Object.values(registry)) {
      if (!operation.channels.tool) continue
      const paths: string[] = []
      collectOptionalProperties(operation.toolInputSchema, paths)
      for (const path of paths) violations.push({ id: operation.id, path })
    }
    expect(violations).toEqual([])
  })
})
