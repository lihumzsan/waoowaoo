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
  shots: [
    {
      shotNumber: 1,
      shotLabel: 'Entrance mark',
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
    },
    {
      shotNumber: 2,
      shotLabel: 'Pillar approach',
      absoluteLocation: 'center of the hall near the first pillar',
      anchorObject: 'the first concrete pillar',
      relationToAnchor: 'half a step in front of the pillar',
      distanceScale: 'slightly closer than shot one',
      bodyFacing: 'walking toward the window light',
      screenPosition: 'center third',
      foregroundLayer: 'floor dust',
      midgroundLayer: 'character and first pillar',
      backgroundLayer: 'tall windows',
      cameraView: 'eye-level medium shot',
      negativeConstraints: [
        'do not hide the character behind the pillar',
        'do not place the character at the wall',
        'do not crop the head',
      ],
    },
    {
      shotNumber: 3,
      shotLabel: 'Window glance',
      absoluteLocation: 'left side of the hall near the window light',
      anchorObject: 'bright window rectangle',
      relationToAnchor: 'one step to the right of the window light',
      distanceScale: 'medium close distance',
      bodyFacing: 'face turned toward the window',
      screenPosition: 'left third',
      foregroundLayer: 'soft floor shadow',
      midgroundLayer: 'character in window light',
      backgroundLayer: 'concrete wall',
      cameraView: 'medium shot from across the hall',
      negativeConstraints: [
        'do not place the character outside the light',
        'do not make the window the main subject',
        'do not crop the torso',
      ],
    },
    {
      shotNumber: 4,
      shotLabel: 'Close hold',
      absoluteLocation: 'beside the pillar row in the middle of the hall',
      anchorObject: 'pillar row',
      relationToAnchor: 'between the first and second pillars',
      distanceScale: 'closer portrait distance',
      bodyFacing: 'body still, face toward camera',
      screenPosition: 'center frame',
      foregroundLayer: 'blurred pillar edge',
      midgroundLayer: 'character face and coat',
      backgroundLayer: 'pillar row receding',
      cameraView: 'eye-level medium close shot',
      negativeConstraints: [
        'do not move the character to the back wall',
        'do not hide the face',
        'do not show a top-down view',
      ],
    },
    {
      shotNumber: 5,
      shotLabel: 'Exit depth',
      absoluteLocation: 'farther down the hall near the second pillar',
      anchorObject: 'second concrete pillar',
      relationToAnchor: 'one step in front of the second pillar',
      distanceScale: 'wide distance with full body visible',
      bodyFacing: 'walking away from camera',
      screenPosition: 'right third',
      foregroundLayer: 'empty floor leading lines',
      midgroundLayer: 'character near second pillar',
      backgroundLayer: 'deep hall perspective',
      cameraView: 'wide eye-level shot',
      negativeConstraints: [
        'do not place the character at the entrance',
        'do not crop the feet',
        'do not remove the second pillar',
      ],
    },
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

    expect(prompt).toContain('continuous sequence')
    expect(prompt).toContain('"shots":[{"shotNumber":number')
    expect(prompt).toContain('"absoluteLocation":"string"')
    expect(prompt).toContain('"negativeConstraints":["string"]')
    expect(prompt).toContain('A man enters a concrete hall.')
  })

  it('builds asset prompts that preserve anchors without adding placement guides', () => {
    expect(buildTextPlacementScenePrompt(placementPlan, 'en')).toContain('Required visible placement anchors: the nearest concrete pillar')
    expect(buildTextPlacementScenePrompt(placementPlan, 'en')).toContain('Do not add text, subtitles, coordinates')
    expect(buildTextPlacementCharacterPrompt(placementPlan, 'en')).toContain('A man wearing a long black coat.')
    expect(buildTextPlacementCharacterPrompt(placementPlan, 'en')).toContain('single-character asset')
  })

  it('builds a final prompt with absolute location, anchor relation, layers, and negative constraints', () => {
    const prompt = buildTextPlacementFinalPrompt({
      storyPrompt: 'A man enters a concrete hall.',
      shot: placementPlan.shots[0],
      locale: 'en',
    })

    expect(prompt).toContain('Current shot: shot 1, Entrance mark')
    expect(prompt).toContain('Character absolute location: center-right of the hall')
    expect(prompt).toContain('Placement anchor: the nearest concrete pillar')
    expect(prompt).toContain('Character relation to anchor: one body width to the left')
    expect(prompt).toContain('Foreground: empty dusty floor')
    expect(prompt).toContain('do not place the character behind the pillar')
    expect(prompt).toContain('Do not include text, subtitles, coordinates')
  })
})
