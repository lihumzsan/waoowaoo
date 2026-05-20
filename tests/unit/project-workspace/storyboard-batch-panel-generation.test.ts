import { describe, expect, it } from 'vitest'
import {
  STORYBOARD_PANEL_BATCH_SUBMIT_LIMIT,
  createStoryboardPanelGenerationBatches,
} from '@/features/project-workspace/components/storyboard/hooks/useStoryboardBatchPanelGeneration'

describe('storyboard batch panel generation', () => {
  it('submits storyboard panel image jobs in batches of twenty', () => {
    const panelIds = Array.from({ length: 45 }, (_, index) => `panel-${index + 1}`)

    const batches = createStoryboardPanelGenerationBatches(panelIds)

    expect(STORYBOARD_PANEL_BATCH_SUBMIT_LIMIT).toBe(20)
    expect(batches.map((batch) => batch.length)).toEqual([20, 20, 5])
    expect(batches[0]).toEqual(panelIds.slice(0, 20))
    expect(batches[1]).toEqual(panelIds.slice(20, 40))
    expect(batches[2]).toEqual(panelIds.slice(40, 45))
  })

  it('fails explicitly for invalid batch sizes', () => {
    expect(() => createStoryboardPanelGenerationBatches(['panel-1'], 0)).toThrow(
      'STORYBOARD_PANEL_BATCH_SIZE_INVALID:0',
    )
  })
})
