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
})
