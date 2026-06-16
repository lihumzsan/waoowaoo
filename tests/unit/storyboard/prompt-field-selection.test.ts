import { describe, expect, it } from 'vitest'
import {
  applyGridPromptFieldOmissions,
  applyPanelPromptFieldOmissions,
  parseStoryboardPromptFieldOmissions,
  STORYBOARD_PROMPT_FIELD_PRESETS,
} from '@/lib/storyboard/prompt-field-selection'

function asRecord(value: unknown): Record<string, unknown> {
  expect(value).toEqual(expect.any(Object))
  return value as Record<string, unknown>
}

describe('storyboard prompt field selection', () => {
  it('accepts preset field ids including the final Style Bible block', () => {
    const presetFields = STORYBOARD_PROMPT_FIELD_PRESETS.flatMap((preset) => preset.fieldIds)
    const parsed = parseStoryboardPromptFieldOmissions([
      ...presetFields,
      'style_bible',
      'unknown.field',
    ])

    expect(parsed).toContain('style_bible')
    expect(parsed).toContain('panel.photography_rules.shot_blocking')
    expect(parsed).toContain('panel.photography_rules.color_tone')
    expect(parsed).not.toContain('unknown.field')
  })

  it('removes selected panel fields without mutating the source context', () => {
    const source = {
      panel: {
        panel_id: 'panel-1',
        description: 'panel description',
        photography_rules: {
          lighting: { direction: 'right window' },
          depth_of_field: 'shallow',
          color_tone: 'cold',
          characters: [{ name: 'Hero' }],
          cameraPlan: {
            shotBlocking: 'Hero stays left.',
          },
        },
        shot_blocking: 'Hero stays left.',
        acting_notes: { expression: 'tense' },
      },
      context: {
        character_appearances: [{ name: 'Hero' }],
        location_reference: {
          name: 'Attic',
          spatial_profile: {
            sceneSummary: 'wooden attic',
          },
        },
        reference_images: [{ image_no: '图 1', role: 'character' }],
      },
    }

    const filtered = applyPanelPromptFieldOmissions(source, [
      'panel.photography_rules.lighting',
      'panel.photography_rules.depth_of_field',
      'panel.photography_rules.shot_blocking',
      'panel.acting_notes',
      'context.location_reference.spatial_profile',
    ])

    const output = asRecord(filtered)
    const panel = asRecord(output.panel)
    const rules = asRecord(panel.photography_rules)
    const context = asRecord(output.context)
    const locationReference = asRecord(context.location_reference)
    expect(rules.lighting).toBeUndefined()
    expect(rules.depth_of_field).toBeUndefined()
    expect(rules.cameraPlan).toBeUndefined()
    expect(panel.shot_blocking).toBeUndefined()
    expect(panel.acting_notes).toBeUndefined()
    expect(locationReference.spatial_profile).toBeUndefined()
    expect(rules.color_tone).toBe('cold')
    expect(source.panel.photography_rules.lighting).toEqual({ direction: 'right window' })
  })

  it('removes selected grid cell fields and ignores unknown field ids', () => {
    const source = {
      grid: {
        mode: '2x2',
        source_video_block_id: 'edit-1:video-block:1',
        cells: [
          {
            cell_index: 0,
            cell_position: 'top_left',
            panel: {
              panel_id: 'panel-1',
              image_prompt: 'first prompt',
              photography_rules: {
                lighting: 'right window',
                depth_of_field: 'deep',
              },
              acting_notes: 'move slowly',
            },
            panel_context: {
              location_reference: {
                name: 'Attic',
                spatial_profile: { sceneSummary: 'attic space' },
              },
            },
          },
        ],
      },
      context: {
        reference_images: [{ image_no: '图 1', role: 'location' }],
      },
    }

    const filtered = applyGridPromptFieldOmissions(source, parseStoryboardPromptFieldOmissions([
      'cell.cell_position',
      'panel.photography_rules.lighting',
      'panel.acting_notes',
      'context.reference_images',
      'unknown.field',
    ]))

    const output = asRecord(filtered)
    const grid = asRecord(output.grid)
    const cells = grid.cells as Array<Record<string, unknown>>
    const firstCell = cells[0]
    const panel = asRecord(firstCell?.panel)
    const rules = asRecord(panel.photography_rules)
    const context = asRecord(output.context)
    expect(firstCell?.cell_index).toBe(0)
    expect(firstCell?.cell_position).toBeUndefined()
    expect(rules.lighting).toBeUndefined()
    expect(rules.depth_of_field).toBe('deep')
    expect(panel.acting_notes).toBeUndefined()
    expect(context.reference_images).toBeUndefined()
  })
})
