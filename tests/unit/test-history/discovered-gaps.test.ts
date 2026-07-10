import { describe, expect, it } from 'vitest'
import { DISCOVERED_TEST_GAPS } from '../../history/discovered-gaps'

describe('discovered test gaps', () => {
  it('keeps ids unique and requires concrete evidence', () => {
    const ids = DISCOVERED_TEST_GAPS.map((gap) => gap.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const gap of DISCOVERED_TEST_GAPS) {
      expect(gap.evidence.length, gap.id).toBeGreaterThan(0)
      expect(gap.owner.length, gap.id).toBeGreaterThan(0)
      expect(gap.rationale.length, gap.id).toBeGreaterThan(0)
    }
  })
})
