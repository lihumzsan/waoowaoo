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

  it('does not recursively wrap an existing first-last-frame prompt', () => {
    const prompt = buildDefaultFirstLastFramePrompt({
      firstPanel: {
        videoPrompt: 'the man raises his eyes toward the light',
        firstLastFramePrompt: 'Start from the first frame: old bridge. Bridge naturally into the last frame: old ending.',
      },
      lastPanel: { videoPrompt: 'the blue figure becomes still' },
    })

    expect(prompt).toContain('the man raises his eyes toward the light')
    expect(prompt).not.toContain('old bridge')
    expect(prompt.match(/Start from the first frame:/g)).toHaveLength(1)
    expect(prompt.match(/Bridge naturally into the last frame:/g)).toHaveLength(1)
  })

  it('locks normal video prompts without explicit camera movement to source-frame composition', () => {
    const packet = buildPanelContinuityPacket({
      panel: {
        id: 'panel-1',
        panelIndex: 0,
        description: 'Two people sit across a desk in a quiet office.',
        characters: JSON.stringify([{ name: 'Doctor' }, { name: 'Patient' }]),
        location: 'office',
      },
    })
    const prompt = renderPanelContinuityPrompt({
      packet,
      basePrompt: packet.currentAction,
      generationMode: 'normal',
    })

    expect(prompt).toContain('locked camera and no travel into unseen areas')
    expect(prompt).toContain('The final frame must still contain the same visible character count')
  })

  it('preserves explicit push-in camera movement from the visible prompt', () => {
    const packet = buildPanelContinuityPacket({
      panel: {
        id: 'panel-2',
        panelIndex: 2,
        description: 'The middle-aged doctor sits behind the desk and speaks.',
        videoPrompt: 'The middle-aged doctor sits behind the desk, speaks, and the camera slowly pushes in.',
        characters: JSON.stringify([{ name: 'Doctor' }]),
        location: 'office',
        cameraMove: 'slow push-in',
      },
    })
    const prompt = renderPanelContinuityPrompt({
      packet,
      basePrompt: packet.currentAction,
      generationMode: 'normal',
    })

    expect(prompt).toContain('Preserve only the explicitly requested camera movement')
    expect(prompt).toContain('camera slowly pushes in')
    expect(prompt).toContain('avoid extreme close-ups, side profiles, face-only crops')
    expect(prompt).toContain('Do not add unrequested hand-to-face gestures')
    expect(prompt).toContain('Do not add subtitles, captions, text overlays')
    expect(prompt).toContain('never cut to another room, hallway, crowd, uniformed people')
    expect(prompt).not.toContain('do not orbit, pan, zoom')
  })

  it('omits neighboring shot action details from normal single-shot prompts', () => {
    const packet = buildPanelContinuityPacket({
      panel: {
        id: 'panel-2',
        panelIndex: 2,
        videoPrompt: 'The doctor sits behind the desk, looks forward, and speaks.',
        characters: JSON.stringify([{ name: 'Doctor' }]),
        location: 'office',
      },
      previousPanel: {
        panelIndex: 1,
        videoPrompt: 'The doctor raises his hand and pushes his glasses.',
        characters: JSON.stringify([{ name: 'Doctor' }]),
        location: 'office',
      },
      nextPanel: {
        panelIndex: 3,
        videoPrompt: 'The young man turns his head to the left.',
        characters: JSON.stringify([{ name: 'Young man' }]),
        location: 'office',
      },
    })
    const prompt = renderPanelContinuityPrompt({
      packet,
      basePrompt: packet.currentAction,
      generationMode: 'normal',
    })

    expect(prompt).toContain('Previous shot context: continuity reference only; do not animate previous shot action.')
    expect(prompt).toContain('Next shot context: continuity reference only; do not animate next shot action.')
    expect(prompt).not.toContain('pushes his glasses')
    expect(prompt).not.toContain('turns his head')
  })
})
