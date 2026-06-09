import { describe, expect, it } from 'vitest'
import {
  applyEditScriptVideoPrompts,
  normalizeEditAssetRequirements,
  normalizeEditScriptCore,
  normalizeEditScriptStructure,
  resolveEditScriptDefaults,
} from '@/lib/edit-script/normalize'

describe('edit script normalization', () => {
  it('keeps the minimum edit table fields and enforces continuous shot numbers', () => {
    const normalized = normalizeEditScriptCore({
      title: 'Orbital Silence',
      durationSec: 60,
      shots: [
        {
          shotNumber: 1,
          durationSec: 5,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'A pilot crosses a white corridor.',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'Pilot / White Corridor',
          sound: 'low air-conditioning hum',
        },
        {
          shotNumber: 2,
          durationSec: 4,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'The corridor opens to a red observation room.',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'Pilot / Red Observation Room',
          sound: 'sub-bass pulse',
        },
      ],
      videoBlocks: [
        { type: 'group', shotNumbers: [1, 2], gridMode: '2x2', reason: 'continuous corridor movement', prompt: 'final continuous corridor prompt' },
      ],
    })

    expect(normalized.shotCount).toBe(2)
    expect(normalized.durationSec).toBe(9)
    expect(normalized.videoBlocks).toEqual([
      { kind: 'group', shotNumbers: [1, 2], gridMode: '2x2', reason: 'continuous corridor movement', prompt: 'final continuous corridor prompt' },
    ])
    expect(normalized.shots[0]).toEqual({
      shotNumber: 1,
      durationSec: 5,
      dramaticPurpose: 'test dramatic purpose',
      visibleAction: 'A pilot crosses a white corridor.',
      audienceFocus: 'test audience focus',
      viewpoint: 'test viewpoint',
      revealPlan: 'test reveal plan',
      performanceBeat: 'test performance beat',
      continuityIn: 'test continuity in',
      continuityOut: 'test continuity out',
      charactersAndScene: 'Pilot / White Corridor',
      sound: 'low air-conditioning hum',
    })
  })

  it('rejects gaps in shot numbering', () => {
    expect(() => normalizeEditScriptCore({
      title: 'Gap',
      durationSec: 60,
      shots: [
        {
          shotNumber: 1,
          durationSec: 4,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'First.',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'A / Room',
          sound: 'tone',
        },
        {
          shotNumber: 3,
          durationSec: 4,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'Third.',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'A / Room',
          sound: 'tone',
        },
      ],
      videoBlocks: [
        { type: 'group', shotNumbers: [1, 3], gridMode: '2x2', reason: 'invalid gap should fail earlier', prompt: 'invalid gap prompt' },
      ],
    })).toThrow('EDIT_SCRIPT_SHOT_NUMBER_NOT_CONTINUOUS')
  })

  it('rejects edit-first shots longer than five seconds', () => {
    expect(() => normalizeEditScriptCore({
      title: 'Too Long',
      durationSec: 6,
      shots: [
        {
          shotNumber: 1,
          durationSec: 6,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'One shot holds too long.',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'A / Room',
          sound: 'tone',
        },
      ],
      videoBlocks: [
        { type: 'single', shotNumbers: [1], reason: 'single long shot', prompt: 'single long prompt' },
      ],
    })).toThrow()
  })

  it('rejects videoBlocks whose grouped duration exceeds Seedance 2.0 limit', () => {
    expect(() => normalizeEditScriptCore({
      title: 'Too Long Group',
      durationSec: 17,
      shots: [
        {
          shotNumber: 1,
          durationSec: 5,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'First move.',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'A / Room',
          sound: 'tone',
        },
        {
          shotNumber: 2,
          durationSec: 4,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'Second move.',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'A / Room',
          sound: 'tone',
        },
        {
          shotNumber: 3,
          durationSec: 3,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'Third move.',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'A / Room',
          sound: 'tone',
        },
        {
          shotNumber: 4,
          durationSec: 5,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'Fourth move.',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'A / Room',
          sound: 'tone',
        },
      ],
      videoBlocks: [
        { type: 'group', shotNumbers: [1, 2, 3, 4], gridMode: '2x2', reason: 'too long for one Seedance segment', prompt: 'too long group prompt' },
      ],
    })).toThrow('VIDEO_BLOCK_PLAN_GROUP_DURATION_UNSUPPORTED:17')
  })

  it('extracts only character and location requirements linked to real shots', () => {
    const shots = normalizeEditScriptCore({
      title: 'Assets',
      durationSec: 16,
      shots: [
        {
          shotNumber: 1,
          durationSec: 4,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'Pilot waits.',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'Pilot / Dock',
          sound: 'hum',
        },
        {
          shotNumber: 2,
          durationSec: 4,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'Pilot enters.',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'Pilot / Dock',
          sound: 'door',
        },
      ],
      videoBlocks: [
        { type: 'group', shotNumbers: [1, 2], gridMode: '2x2', reason: 'shared dock motion', prompt: 'shared dock prompt' },
      ],
    }).shots

    const assets = normalizeEditAssetRequirements({
      assets: [
        {
          kind: 'character',
          name: 'Pilot',
          description: 'A quiet astronaut in a minimal pressure suit.',
          shotNumbers: [2, 1, 2],
        },
        {
          kind: 'location',
          name: 'Dock',
          description: 'A sterile orbital docking bay with red warning light.',
          shotNumbers: [1, 3],
        },
      ],
    }, shots)

    expect(assets).toEqual([
      {
        kind: 'character',
        name: 'Pilot',
        description: 'A quiet astronaut in a minimal pressure suit.',
        shotNumbers: [1, 2],
        status: 'pending',
        targetId: null,
        errorMessage: null,
      },
      {
        kind: 'location',
        name: 'Dock',
        description: 'A sterile orbital docking bay with red warning light.',
        shotNumbers: [1],
        status: 'pending',
        targetId: null,
        errorMessage: null,
      },
    ])
  })

  it('accepts character assets with visual description only', () => {
    const shots = normalizeEditScriptCore({
      title: 'Assets',
      durationSec: 4,
      shots: [
        {
          shotNumber: 1,
          durationSec: 4,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'Pilot enters the dock.',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'Pilot / Dock',
          sound: 'door',
        },
      ],
      videoBlocks: [
        { type: 'single', shotNumbers: [1], reason: 'single beat', prompt: 'single prompt' },
      ],
    }).shots

    const assets = normalizeEditAssetRequirements({
      assets: [
        {
          kind: 'character',
          name: 'Pilot',
          description: 'A quiet astronaut in a minimal pressure suit.',
          shotNumbers: [1],
        },
      ],
    }, shots)

    expect(assets[0]).toEqual(expect.objectContaining({
      kind: 'character',
      name: 'Pilot',
      description: 'A quiet astronaut in a minimal pressure suit.',
    }))
  })

  it('splits structure normalization from final video prompt rendering', () => {
    const structure = normalizeEditScriptStructure({
      title: 'Prompt Later',
      durationSec: 6,
      shots: [
        {
          shotNumber: 1,
          durationSec: 3,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'Pilot steps into the dock.',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'Pilot / Dock',
          sound: 'room tone',
        },
        {
          shotNumber: 2,
          durationSec: 3,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'Pilot reaches the console.',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'Pilot / Dock',
          sound: 'console beep continues',
        },
      ],
      videoBlocks: [
        { type: 'group', shotNumbers: [1, 2], reason: 'continuous dock movement' },
      ],
    })

    expect(structure.videoBlocks[0]?.prompt).toBe('Pending final video prompt.')

    const completed = applyEditScriptVideoPrompts(structure, {
      shots: [
        { shotNumber: 1, videoPrompt: 'Pilot enters the dock, wide push.' },
        { shotNumber: 2, videoPrompt: 'Pilot reaches the console, medium track.' },
      ],
      videoBlocks: [
        { shotNumbers: [1, 2], prompt: 'Continuous dock prompt with asset identity.' },
      ],
    })

    expect(completed.shots.map((shot) => shot.visibleAction)).toEqual([
      'Pilot steps into the dock.',
      'Pilot reaches the console.',
    ])
    expect(completed.videoBlocks[0]?.prompt).toBe('Continuous dock prompt with asset identity.')
  })

  it('rejects video prompt output that changes locked block coverage', () => {
    const structure = normalizeEditScriptStructure({
      title: 'Locked',
      durationSec: 3,
      shots: [
        {
          shotNumber: 1,
          durationSec: 4,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'Pilot waits.',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'Pilot / Dock',
          sound: 'hum',
        },
      ],
      videoBlocks: [
        { type: 'single', shotNumbers: [1], reason: 'isolated beat' },
      ],
    })

    expect(() => applyEditScriptVideoPrompts(structure, {
      shots: [{ shotNumber: 1, videoPrompt: 'Pilot waits.' }],
      videoBlocks: [{ shotNumbers: [2], prompt: 'Wrong block.' }],
    })).toThrow('EDIT_SCRIPT_VIDEO_PROMPT_BLOCK_MISSING:1')
  })

  it('defaults short-film requests to 60 seconds without prescribing shot count', () => {
    expect(resolveEditScriptDefaults('给我一个库布里克风格科幻短片')).toEqual({
      durationSeconds: 60,
    })
    expect(resolveEditScriptDefaults('给我一个一分钟科幻短片')).toEqual({
      durationSeconds: 60,
    })
  })

  it('caps edit-first test launch duration requests to 120 seconds', () => {
    expect(resolveEditScriptDefaults('给我一个3分钟科幻短片')).toEqual({
      durationSeconds: 120,
    })
    expect(resolveEditScriptDefaults('make a 300 seconds sci-fi short')).toEqual({
      durationSeconds: 120,
    })
  })
})
