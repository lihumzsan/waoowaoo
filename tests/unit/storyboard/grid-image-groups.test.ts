import { describe, expect, it } from 'vitest'
import { planStoryboardPanelImageSubmissionGroups } from '@/lib/storyboard/grid-image-groups'

function panel(id: string, panelIndex: number, sourceGenerationSegmentId: string | null) {
  return {
    id,
    storyboardId: 'storyboard-1',
    panelIndex,
    sourceGenerationSegmentId,
  }
}

describe('storyboard grid image group planner', () => {
  it('keeps every panel as an individual task when generation mode is single', () => {
    const groups = planStoryboardPanelImageSubmissionGroups([
      panel('panel-2', 1, 'edit-1:generationSegment:1'),
      panel('panel-1', 0, 'edit-1:generationSegment:1'),
    ], 'single')

    expect(groups).toEqual([
      {
        kind: 'single',
        panels: [expect.objectContaining({ id: 'panel-1' })],
      },
      {
        kind: 'single',
        panels: [expect.objectContaining({ id: 'panel-2' })],
      },
    ])
  })

  it('groups multiple missing panels from the same generation segment into one 2x2 grid task', () => {
    const groups = planStoryboardPanelImageSubmissionGroups([
      panel('panel-1', 0, 'edit-1:generationSegment:1'),
      panel('panel-2', 1, 'edit-1:generationSegment:1'),
      panel('panel-3', 2, null),
    ])

    expect(groups).toEqual([
      {
        kind: 'grid2x2',
        sourceGenerationSegmentId: 'edit-1:generationSegment:1',
        panels: [
          expect.objectContaining({ id: 'panel-1' }),
          expect.objectContaining({ id: 'panel-2' }),
        ],
      },
      {
        kind: 'single',
        panels: [expect.objectContaining({ id: 'panel-3' })],
      },
    ])
  })

  it('splits large grouped blocks into fixed four-cell grid tasks and keeps remainders single', () => {
    const groups = planStoryboardPanelImageSubmissionGroups([
      panel('panel-1', 0, 'edit-1:generationSegment:1'),
      panel('panel-2', 1, 'edit-1:generationSegment:1'),
      panel('panel-3', 2, 'edit-1:generationSegment:1'),
      panel('panel-4', 3, 'edit-1:generationSegment:1'),
      panel('panel-5', 4, 'edit-1:generationSegment:1'),
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0]).toEqual({
      kind: 'grid2x2',
      sourceGenerationSegmentId: 'edit-1:generationSegment:1',
      panels: [
        expect.objectContaining({ id: 'panel-1' }),
        expect.objectContaining({ id: 'panel-2' }),
        expect.objectContaining({ id: 'panel-3' }),
        expect.objectContaining({ id: 'panel-4' }),
      ],
    })
    expect(groups[1]).toEqual({
      kind: 'single',
      panels: [expect.objectContaining({ id: 'panel-5' })],
    })
  })
})
