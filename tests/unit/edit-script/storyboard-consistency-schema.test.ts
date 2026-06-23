import { describe, expect, it } from 'vitest'
import { panelFinalPromptBlockModelOutputSchema } from '@/lib/edit-script/storyboard-consistency/types'

describe('edit script storyboard consistency schemas', () => {
  it('accepts cameraMovement inside shotBlocking for final prompt block output', () => {
    const parsed = panelFinalPromptBlockModelOutputSchema.parse({
      panelFinalPromptBlockOutput: {
        sourceVideoBlockId: 'edit-script-1:videoBlock:1',
        panels: [{
          panelIndex: 0,
          sourceShotNumber: 1,
          sourceVideoBlockId: 'edit-script-1:videoBlock:1',
          shotBlocking: {
            locationName: 'Attic',
            absolutePosition: 'on the central shelf',
            relativePosition: 'near the left skylight',
            screenPosition: 'center frame',
            characterPlacements: [{
              characterName: 'Emily',
              absolutePosition: 'on the central shelf',
              relativePosition: 'above the shadow',
              screenPosition: 'upper center',
              facing: 'toward the shadow',
              eyeline: 'toward the shadow',
            }],
            cameraPlacement: 'front of the shelf',
            cameraMovement: 'locked static camera',
            composition: 'centered gothic composition',
            continuityNote: 'keep the same shelf axis',
          },
          finalPanelPrompt: 'A complete concrete storyboard image prompt with enough detail for one cinematic frame.',
          finalVideoPrompt: 'A complete concrete video prompt with enough detail for camera movement and action timing.',
        }],
      },
    })

    expect(parsed.panelFinalPromptBlockOutput.panels[0]?.shotBlocking.cameraMovement).toBe('locked static camera')
  })

  it('rejects cinematography fields emitted inside shotBlocking', () => {
    const result = panelFinalPromptBlockModelOutputSchema.safeParse({
      panelFinalPromptBlockOutput: {
        sourceVideoBlockId: 'edit-script-1:videoBlock:1',
        panels: [{
          panelIndex: 0,
          sourceShotNumber: 1,
          sourceVideoBlockId: 'edit-script-1:videoBlock:1',
          shotBlocking: {
            locationName: 'Bedroom',
            absolutePosition: 'beside the bed',
            relativePosition: 'near the bedside table',
            screenPosition: 'lower center',
            characterPlacements: [],
            cameraPlacement: 'front of the bed',
            cameraMovement: 'locked static camera',
            composition: 'warm centered composition',
            continuityNote: 'keep the same bed axis',
            lighting: 'soft warm bedside light',
          },
          finalPanelPrompt: 'A complete concrete storyboard image prompt with enough detail for one cinematic frame.',
          finalVideoPrompt: 'A complete concrete video prompt with enough detail for camera movement and action timing.',
        }],
      },
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe('unrecognized_keys')
      expect(result.error.issues[0]?.path).toEqual([
        'panelFinalPromptBlockOutput',
        'panels',
        0,
        'shotBlocking',
      ])
    }
  })
})
