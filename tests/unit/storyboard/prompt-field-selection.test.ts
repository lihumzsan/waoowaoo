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

function buildRenderFacts() {
  return {
    SCENE: { name: 'Attic', action: 'Hero enters' },
    CHARACTERS: [{ name: 'Hero', visibility: 'visible' }],
    PROPS: [{ name: 'Chair', role: 'anchor' }],
    CAMERA: { shotScale: 'medium', lighting: 'side light' },
    AXIS: { subjects: ['Hero', 'Chair'], screenDirection: 'Hero stays left' },
    STYLE: { summary: 'cinematic' },
  }
}

describe('storyboard prompt field selection', () => {
  it('accepts preset field ids for structured render facts', () => {
    const presetFields = STORYBOARD_PROMPT_FIELD_PRESETS.flatMap((preset) => preset.fieldIds)
    const parsed = parseStoryboardPromptFieldOmissions([
      ...presetFields,
      'style_bible',
      'unknown.field',
    ])

    expect(parsed).toContain('style_bible')
    expect(parsed).toContain('render_facts.SCENE')
    expect(parsed).toContain('render_facts.CAMERA')
    expect(parsed).not.toContain('unknown.field')
  })

  it('removes selected still render facts without mutating the source context', () => {
    const source = buildRenderFacts()

    const filtered = applyPanelPromptFieldOmissions(source, [
      'render_facts.SCENE',
      'render_facts.CAMERA',
      'style_bible',
    ])

    const output = asRecord(filtered)
    expect(output.SCENE).toBeUndefined()
    expect(output.STYLE).toBeUndefined()
    expect(output.CAMERA).toBeUndefined()
    expect(output.AXIS).toEqual({ subjects: ['Hero', 'Chair'], screenDirection: 'Hero stays left' })
    expect(source.SCENE).toEqual({ name: 'Attic', action: 'Hero enters' })
  })

  it('removes selected grid cell render facts and ignores unknown field ids', () => {
    const source = {
      grid: {
        mode: '2x2',
        source_generation_segment_id: 'edit-1:generationSegment:1',
        cells: [
          {
            cell_index: 0,
            cell_position: 'top_left',
            panel_facts: {
              panel_id: 'panel-1',
              render_facts: buildRenderFacts(),
            },
          },
        ],
      },
      context: {
        reference_images: [{ image_no: '图 1', role: 'location' }],
        additional_reference_images: [{ reference_image_order: 1, note: 'previous grid' }],
      },
    }

    const filtered = applyGridPromptFieldOmissions(source, parseStoryboardPromptFieldOmissions([
      'grid.source_generation_segment_id',
      'cell.cell_position',
      'cell.panel_id',
      'render_facts.AXIS',
      'context.reference_images',
      'unknown.field',
    ]))

    const output = asRecord(filtered)
    const grid = asRecord(output.grid)
    const cells = grid.cells as Array<Record<string, unknown>>
    const firstCell = cells[0]
    const panelFacts = asRecord(firstCell?.panel_facts)
    const renderFacts = asRecord(panelFacts.render_facts)
    const context = asRecord(output.context)
    expect(grid.source_generation_segment_id).toBeUndefined()
    expect(firstCell?.cell_index).toBe(0)
    expect(firstCell?.cell_position).toBeUndefined()
    expect(panelFacts.panel_id).toBeUndefined()
    expect(renderFacts.AXIS).toBeUndefined()
    expect(context.reference_images).toBeUndefined()
    expect(context.additional_reference_images).toEqual([{ reference_image_order: 1, note: 'previous grid' }])
  })
})
