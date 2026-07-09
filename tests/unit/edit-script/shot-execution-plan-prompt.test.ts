import { describe, expect, it } from 'vitest'
import { buildShotExecutionPlanPromptStructure } from '@/lib/edit-script/shot-execution-plan-prompt'

describe('shot execution plan prompt structure', () => {
  it('renames generation segment continuity before sending edit structure to the shot execution prompt', () => {
    const structure = buildShotExecutionPlanPromptStructure({
      id: 'script-1',
      durationSec: 12,
      shotCount: 2,
      sourceText: 'source slice',
      shots: [],
      generationSegments: [
        {
          shotIds: ['shot-1', 'shot-2'],
          continuity: 'Keep the hand movement continuous across the cut.',
        },
      ],
    })

    expect(structure).toEqual({
      id: 'script-1',
      durationSec: 12,
      shotCount: 2,
      sourceText: 'source slice',
      shots: [],
      videoGenerationSegments: [
        {
          shotIds: ['shot-1', 'shot-2'],
          continuityReference: 'Keep the hand movement continuous across the cut.',
        },
      ],
    })
    expect(JSON.stringify(structure)).not.toContain('"continuity":')
  })
})
