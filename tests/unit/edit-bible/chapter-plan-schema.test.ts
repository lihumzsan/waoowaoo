import { describe, expect, it } from 'vitest'
import { creativeChapterPlanOutputSchema } from '@/lib/edit-bible'

function chapter(overrides: Partial<{
  chapterIndex: number
  sourceStart: number
  sourceEnd: number
  targetDurationSec: number
}> = {}) {
  return {
    chapterIndex: 0,
    title: 'Opening movement',
    summary: 'A complete independently usable narrative movement.',
    sourceStart: 0,
    sourceEnd: 100,
    targetDurationSec: 120,
    ...overrides,
  }
}

describe('Creative Chapter plan output', () => {
  it('accepts ordered model-authored ranges without requiring a Bible', () => {
    expect(creativeChapterPlanOutputSchema.parse({
      kind: 'chapter_plan',
      rationale: 'The screenplay contains two independent production contexts.',
      chapters: [
        chapter(),
        chapter({ chapterIndex: 1, sourceStart: 100, sourceEnd: 240, targetDurationSec: 180 }),
      ],
      assumptions: [],
      warnings: [],
    }).chapters).toHaveLength(2)
  })

  it('rejects non-contiguous indexes, overlapping ranges, and durations above 180 seconds', () => {
    expect(() => creativeChapterPlanOutputSchema.parse({
      kind: 'chapter_plan',
      rationale: 'Invalid plan.',
      chapters: [
        chapter(),
        chapter({ chapterIndex: 2, sourceStart: 99, sourceEnd: 240, targetDurationSec: 181 }),
      ],
      assumptions: [],
      warnings: [],
    })).toThrow()
  })
})
