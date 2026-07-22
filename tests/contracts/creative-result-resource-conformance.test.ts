import { describe, expect, it } from 'vitest'
import { createAssistantCreativeBibleOperations } from '@/lib/operations/domains/assistant/creative-bible-ops'
import { createAssistantCreativeStyleOperations } from '@/lib/operations/domains/assistant/creative-style-ops'
import { createCreativeResourceOperations } from '@/lib/operations/domains/creative-resource/resource-ops'

describe('creative result Resource conformance', () => {
  it('adopts an exact materialized Style Bible revision instead of copying a Task candidate', () => {
    const operation = createAssistantCreativeStyleOperations().adopt_style_bible
    expect(operation).toBeDefined()
    expect(operation?.inputSchema.safeParse({
      resourceId: 'style-resource',
      revisionId: 'style-revision',
      fingerprint: 'style-fingerprint',
      expectedVersion: null,
    }).success).toBe(true)
    expect(operation?.inputSchema.safeParse({
      taskId: 'style-task',
      name: 'Style',
      selection: { kind: 'candidate', styleKey: 'style_b' },
      expectedVersion: null,
    }).success).toBe(false)
  })

  it('keeps Bible and model-authored Chapter-plan adoption as separate operations', () => {
    expect(createCreativeResourceOperations()).not.toHaveProperty('confirm_script_resource')
    const operations = createAssistantCreativeBibleOperations()
    expect(Object.keys(operations).sort()).toEqual(['adopt_bible', 'adopt_chapters'])
    expect(operations.adopt_bible?.choiceCommit).toEqual({ enabled: true })
    expect(operations.adopt_bible?.inputSchema.safeParse({
      screenplay: { resourceId: 'screenplay', revisionId: 'screenplay-r1', fingerprint: 'screenplay-fp' },
      bible: { resourceId: 'bible', revisionId: 'bible-r1', fingerprint: 'bible-fp' },
      expectedVersion: null,
    }).success).toBe(true)
    expect(operations.adopt_chapters?.choiceCommit).toEqual({ enabled: true })
    expect(operations.adopt_chapters?.inputSchema.safeParse({
      screenplay: { resourceId: 'screenplay', revisionId: 'screenplay-r1', fingerprint: 'screenplay-fp' },
      chapterPlan: { resourceId: 'chapter-plan', revisionId: 'chapter-plan-r1', fingerprint: 'chapter-plan-fp' },
    }).success).toBe(true)
    expect(operations.adopt_chapters?.inputSchema.safeParse({
      episodeId: 'episode',
      bibleRevisionId: 'bible-r1',
    }).success).toBe(false)
  })
})
