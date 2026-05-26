import { describe, expect, it } from 'vitest'
import {
  buildTextPlacementCharacterPrompt,
  buildTextPlacementFinalPrompt,
  buildTextPlacementPlanPrompt,
  buildTextPlacementScenePrompt,
} from '@/lib/text-placement-test/prompt'
import { textPlacementTestRunRequestSchema, type TextPlacementPlan } from '@/lib/text-placement-test/types'

const placementPlan: TextPlacementPlan = {
  sceneBrief: 'A concrete hall with tall windows and a row of pillars.',
  characterBrief: 'A man wearing a long black coat.',
  absoluteLocation: 'center-right of the hall, two steps in front of the rear wall',
  anchorObject: 'the nearest concrete pillar',
  relationToAnchor: 'one body width to the left of the pillar, not hidden by it',
  distanceScale: 'medium distance from camera, full body visible',
  bodyFacing: 'body angled toward camera, face looking toward the window light',
  screenPosition: 'lower center-right third, occupying half of frame height',
  foregroundLayer: 'empty dusty floor',
  midgroundLayer: 'the character beside the concrete pillar',
  backgroundLayer: 'rear wall and tall windows',
  cameraView: 'eye-level medium full shot from the hall entrance',
  negativeConstraints: [
    'do not place the character behind the pillar',
    'do not place the character outside the hall',
    'do not crop off the feet',
  ],
}

describe('text placement test prompt', () => {
  it('builds a strict JSON planning prompt from a story', () => {
    const parsed = textPlacementTestRunRequestSchema.parse({
      storyPrompt: 'A man enters a concrete hall.',
      llmModelKey: 'llm-model-1',
      imageModelKey: 'image-model-1',
    })

    const prompt = buildTextPlacementPlanPrompt(parsed, 'en')

    expect(prompt).toContain('text-based absolute placement plan')
    expect(prompt).toContain('"absoluteLocation":"string"')
    expect(prompt).toContain('"negativeConstraints":["string"]')
    expect(prompt).toContain('A man enters a concrete hall.')
  })

  it('builds asset prompts that preserve anchors without adding placement guides', () => {
    expect(buildTextPlacementScenePrompt(placementPlan, 'en')).toContain('Required visible placement anchor: the nearest concrete pillar')
    expect(buildTextPlacementScenePrompt(placementPlan, 'en')).toContain('Do not add text, subtitles, coordinates')
    expect(buildTextPlacementCharacterPrompt(placementPlan, 'en')).toContain('A man wearing a long black coat.')
    expect(buildTextPlacementCharacterPrompt(placementPlan, 'en')).toContain('single-character asset')
  })

  it('builds a final prompt with absolute location, anchor relation, layers, and negative constraints', () => {
    const prompt = buildTextPlacementFinalPrompt({
      storyPrompt: 'A man enters a concrete hall.',
      plan: placementPlan,
      locale: 'en',
    })

    expect(prompt).toContain('Character absolute location: center-right of the hall')
    expect(prompt).toContain('Placement anchor: the nearest concrete pillar')
    expect(prompt).toContain('Character relation to anchor: one body width to the left')
    expect(prompt).toContain('Foreground: empty dusty floor')
    expect(prompt).toContain('do not place the character behind the pillar')
    expect(prompt).toContain('Do not include text, subtitles, coordinates')
  })
})
