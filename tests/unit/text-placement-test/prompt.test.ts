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
  characterABrief: 'Character A is a man wearing a long black coat and dark glasses.',
  characterBBrief: 'Character B is a woman wearing a red jacket and short hair.',
  shots: Array.from({ length: 5 }, (_, index) => ({
    shotNumber: index + 1,
    shotLabel: index === 0 ? 'Separated by pillar' : `Relationship beat ${index + 1}`,
    characterAPlacement: {
      absoluteLocation: index === 0
        ? 'center-right of the hall, two steps in front of the rear wall'
        : `hall zone A ${index + 1}`,
      anchorObject: index === 0 ? 'the nearest concrete pillar' : `pillar A ${index + 1}`,
      relationToAnchor: index === 0
        ? 'one body width to the left of the pillar, not hidden by it'
        : `one step from pillar A ${index + 1}`,
      distanceScale: 'medium distance from camera, full body visible',
      bodyFacing: 'body angled toward character B',
      screenPosition: 'lower center-right third',
    },
    characterBPlacement: {
      absoluteLocation: index === 0
        ? 'left side of the hall near the window light'
        : `hall zone B ${index + 1}`,
      anchorObject: index === 0 ? 'bright window rectangle' : `window B ${index + 1}`,
      relationToAnchor: index === 0
        ? 'one step to the right of the window light, facing character A'
        : `one step from window B ${index + 1}`,
      distanceScale: 'slightly farther from camera than character A',
      bodyFacing: 'body turned toward character A',
      screenPosition: 'left third',
    },
    relationshipBetweenCharacters: index === 0
      ? 'character A and character B face each other across the nearest concrete pillar'
      : `relationship beat ${index + 1}`,
    foregroundLayer: 'empty dusty floor',
    midgroundLayer: 'both characters separated by the concrete pillar',
    backgroundLayer: 'rear wall and tall windows',
    cameraView: 'eye-level medium full shot from the hall entrance',
    negativeConstraints: [
      'do not merge character A and character B',
      'do not swap character A and character B identities',
      'do not show only one character',
    ],
  })),
}

describe('text placement test prompt', () => {
  it('builds a strict two-character JSON planning prompt from a story', () => {
    const parsed = textPlacementTestRunRequestSchema.parse({
      storyPrompt: 'Two people meet in a concrete hall.',
      llmModelKey: 'llm-model-1',
      imageModelKey: 'image-model-1',
    })

    const prompt = buildTextPlacementPlanPrompt(parsed, 'en')

    expect(prompt).toContain('two-character text-based absolute placement shots')
    expect(prompt).toContain('"characterABrief":"string"')
    expect(prompt).toContain('"characterAPlacement"')
    expect(prompt).toContain('"relationshipBetweenCharacters":"string"')
    expect(prompt).toContain('Two people meet in a concrete hall.')
  })

  it('builds asset prompts that preserve anchors and separate character identities', () => {
    expect(buildTextPlacementScenePrompt(placementPlan, 'en')).toContain('Required visible placement anchors: the nearest concrete pillar, bright window rectangle')
    expect(buildTextPlacementScenePrompt(placementPlan, 'en')).toContain('Do not add text, subtitles, coordinates')
    expect(buildTextPlacementCharacterPrompt(placementPlan, 'en', 'A')).toContain('Character A brief: Character A is a man wearing a long black coat')
    expect(buildTextPlacementCharacterPrompt(placementPlan, 'en', 'A')).toContain('Do not include character B')
    expect(buildTextPlacementCharacterPrompt(placementPlan, 'en', 'B')).toContain('Character B brief: Character B is a woman wearing a red jacket')
    expect(buildTextPlacementCharacterPrompt(placementPlan, 'en', 'B')).toContain('Do not include character A')
  })

  it('builds a final prompt with both character placements, relationship, and identity constraints', () => {
    const prompt = buildTextPlacementFinalPrompt({
      storyPrompt: 'Two people meet in a concrete hall.',
      shot: placementPlan.shots[0],
      locale: 'en',
    })

    expect(prompt).toContain('reference image 2 as character A')
    expect(prompt).toContain('reference image 3 as character B')
    expect(prompt).toContain('Current shot: shot 1, Separated by pillar')
    expect(prompt).toContain('Character A absolute location: center-right of the hall')
    expect(prompt).toContain('Character B absolute location: left side of the hall')
    expect(prompt).toContain('Relationship between characters: character A and character B face each other')
    expect(prompt).toContain('do not merge character A and character B')
    expect(prompt).toContain('The final image must contain both character A and character B')
  })
})
