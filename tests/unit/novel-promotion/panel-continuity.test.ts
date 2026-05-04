import { describe, expect, it } from 'vitest'
import {
  buildDefaultFirstLastFramePrompt,
  buildPanelContinuityPacket,
  isStructuredMultiShotPrompt,
  pickPanelContinuityBasePrompt,
  renderPanelContinuityPrompt,
} from '@/lib/novel-promotion/panel-continuity'

const staleMultiShotPrompt = [
  'GLOBAL:',
  'Office night, two doctors talking, cinematic fixed camera.',
  '',
  'LOCAL:',
  '[0.0-2.5] The middle-aged doctor listens carefully | [2.5-5.0] The young doctor raises his hand and pushes glasses',
].join('\n')

describe('panel continuity prompt inputs', () => {
  it('detects structured multi-shot prompts', () => {
    expect(isStructuredMultiShotPrompt(staleMultiShotPrompt)).toBe(true)
    expect(isStructuredMultiShotPrompt('The doctor gently pushes his glasses in one close-up.')).toBe(false)
  })

  it('uses panel facts instead of stale multi-shot prompts for the current action', () => {
    const packet = buildPanelContinuityPacket({
      panel: {
        id: 'panel-1',
        panelIndex: 1,
        videoPrompt: staleMultiShotPrompt,
        videoPromptEditedByUser: false,
        description: 'The middle-aged doctor raises his hand and pushes his glasses.',
        srtSegment: 'The middle-aged doctor pushes his glasses.',
        characters: JSON.stringify([{ name: 'Middle-aged doctor', appearance: 'white coat', slot: 'behind desk' }]),
      },
      previousPanel: {
        panelIndex: 0,
        videoPrompt: staleMultiShotPrompt,
        videoPromptEditedByUser: false,
        description: 'The empty office is lit by a pale lamp.',
      },
    })

    expect(packet.currentAction).toBe('The middle-aged doctor raises his hand and pushes his glasses.')
    expect(packet.previous?.action).toBe('The empty office is lit by a pale lamp.')
    expect(packet.currentAction).not.toContain('GLOBAL')
  })

  it('keeps ordinary user-edited prompts as intent while filtering structured multi-shot prompts', () => {
    expect(pickPanelContinuityBasePrompt({
      videoPrompt: 'The doctor pauses, then gently pushes his glasses.',
      videoPromptEditedByUser: true,
      description: 'The doctor pushes his glasses.',
    })).toBe('The doctor pauses, then gently pushes his glasses.')

    expect(pickPanelContinuityBasePrompt({
      videoPrompt: staleMultiShotPrompt,
      videoPromptEditedByUser: true,
      description: 'The doctor pushes his glasses.',
    })).toBe('The doctor pushes his glasses.')

    expect(pickPanelContinuityBasePrompt({
      videoPrompt: staleMultiShotPrompt,
      videoPromptEditedByUser: false,
      description: 'The doctor pushes his glasses.',
    })).toBe('The doctor pushes his glasses.')
  })

  it('builds first-last defaults without stale multi-shot actions', () => {
    const prompt = buildDefaultFirstLastFramePrompt({
      firstPanel: {
        videoPrompt: staleMultiShotPrompt,
        videoPromptEditedByUser: false,
        description: 'The office starts in a quiet wide shot.',
        characters: JSON.stringify([{ name: 'Chen Ji' }]),
      },
      lastPanel: {
        videoPrompt: staleMultiShotPrompt,
        videoPromptEditedByUser: false,
        description: 'The doctor lifts one hand to push his glasses.',
      },
    })

    expect(prompt).toContain('Start from the first frame: The office starts in a quiet wide shot.')
    expect(prompt).toContain('Bridge naturally into the last frame: The doctor lifts one hand to push his glasses.')
    expect(prompt).not.toContain('GLOBAL:')
  })

  it('locks normal video prompts to source-frame composition', () => {
    const packet = buildPanelContinuityPacket({
      panel: {
        id: 'panel-1',
        panelIndex: 0,
        description: 'Two people sit across a desk while the camera slowly orbits the office.',
        characters: JSON.stringify([{ name: 'Doctor' }, { name: 'Patient' }]),
        location: 'office',
        cameraMove: 'slow orbit',
      },
    })
    const prompt = renderPanelContinuityPrompt({
      packet,
      basePrompt: packet.currentAction,
      generationMode: 'normal',
    })

    expect(prompt).toContain('do not orbit, pan, zoom, or travel into unseen areas')
    expect(prompt).toContain('The final frame must still contain the same visible character count')
  })
})
