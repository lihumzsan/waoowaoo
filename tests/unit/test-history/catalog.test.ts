import { describe, expect, it } from 'vitest'
import { HISTORICAL_DEFECT_CATALOG, validateHistoricalDefectCatalog } from '../../history/catalog'

describe('historical defect catalog', () => {
  it('uses unique ids, full commit hashes, invariants, and planned scenarios', () => {
    expect(() => validateHistoricalDefectCatalog()).not.toThrow()
    expect(HISTORICAL_DEFECT_CATALOG).toHaveLength(6)
    expect(HISTORICAL_DEFECT_CATALOG.map((defect) => defect.module)).toEqual([
      'assistant-run-lifecycle',
      'async-task-lifecycle',
      'assistant-run-lifecycle',
      'canvas-node',
      'provider-gateway',
      'provider-gateway',
    ])
  })

  it('rejects one commit being assigned to two curated root causes', () => {
    const first = HISTORICAL_DEFECT_CATALOG[0]
    const second = HISTORICAL_DEFECT_CATALOG[1]
    expect(() => validateHistoricalDefectCatalog([
      first,
      {
        ...second,
        commits: [first.commits[0]],
      },
    ])).toThrow(`Commit ${first.commits[0]} is assigned to both ${first.id} and ${second.id}`)
  })
})
