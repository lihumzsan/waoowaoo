import { describe, expect, it } from 'vitest'
import {
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

})
