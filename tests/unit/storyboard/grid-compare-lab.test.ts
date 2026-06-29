import { describe, expect, it } from 'vitest'
import { parseStoryboardGridCompareSubmitBody } from '@/lib/storyboard/grid-compare-lab'

describe('storyboard grid compare lab input parsing', () => {
  it('preserves previous grid image url for serial grid-set tests', () => {
    const parsed = parseStoryboardGridCompareSubmitBody({
      episodeId: 'episode-1',
      sourceGenerationSegmentId: 'edit-1:generationSegment:2',
      panelIds: ['panel-1', 'panel-2', 'panel-3', 'panel-4'],
      mode: 'grid_2x2',
      locale: 'zh',
      previousGridImageUrl: 'images/previous-grid.png',
      omittedFields: ['render_facts.CAMERA'],
    })

    expect(parsed).toEqual({
      episodeId: 'episode-1',
      sourceGenerationSegmentId: 'edit-1:generationSegment:2',
      panelIds: ['panel-1', 'panel-2', 'panel-3', 'panel-4'],
      mode: 'grid_2x2',
      locale: 'zh',
      previousGridImageUrl: 'images/previous-grid.png',
      omittedFields: ['render_facts.CAMERA'],
    })
  })
})
