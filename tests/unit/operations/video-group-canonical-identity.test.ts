import { describe, expect, it } from 'vitest'
import { buildCanonicalVideoGroupId } from '@/lib/operations/domains/storyboard/generation/video/video-group-planning'

const BASE_INPUT = {
  projectId: 'project-1',
  episodeId: 'episode-1',
  chapterId: 'chapter-1',
  gridMode: 'continuous',
  shotIds: ['shot-1', 'shot-2'],
} as const

describe('video group canonical identity', () => {
  it('is stable for the same scoped ordered shot group', () => {
    const first = buildCanonicalVideoGroupId(BASE_INPUT)
    const second = buildCanonicalVideoGroupId({ ...BASE_INPUT, shotIds: [...BASE_INPUT.shotIds] })

    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('changes when scope, mode, or ordered shots change', () => {
    const base = buildCanonicalVideoGroupId(BASE_INPUT)
    const variants = [
      { ...BASE_INPUT, projectId: 'project-2' },
      { ...BASE_INPUT, episodeId: 'episode-2' },
      { ...BASE_INPUT, chapterId: 'chapter-2' },
      { ...BASE_INPUT, gridMode: 'single' },
      { ...BASE_INPUT, shotIds: ['shot-2', 'shot-1'] },
    ]

    expect(new Set(variants.map(buildCanonicalVideoGroupId))).not.toContain(base)
    expect(new Set(variants.map(buildCanonicalVideoGroupId))).toHaveLength(variants.length)
  })
})
