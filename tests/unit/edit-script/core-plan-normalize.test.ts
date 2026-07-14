import {
  corePlan,
  describe,
  expect,
  it,
  normalizeEditScriptCore,
} from './normalize.fixture'
import { projectEditScriptCoreNames } from '@/lib/edit-script/core-view'

describe('edit-first core plan normalization', () => {
  it('normalizes the compact core plan and preserves character performances', () => {
    const normalized = normalizeEditScriptCore(corePlan())

    expect(normalized.shotCount).toBe(2)
    expect(normalized.durationSec).toBe(6)
    expect(normalized.generationSegments).toEqual([
      {
        segmentId: 'segment-1',
        shotIds: ['shot-1', 'shot-2'],
        continuity: 'Anna approaches the same high-backed chair in one continuous space.',
      },
    ])
    expect(normalized.shots[0]?.characters).toContainEqual({
      characterId: 'character-grandmother',
      name: 'Disguised Grandmother',
      performance: 'sits silently inside the high-backed chair',
    })
    expect(normalized.shots[1]?.dialogue).toEqual([
      { characterId: 'character-anna', line: 'Who is sitting there?' },
    ])
    expect(normalized.shots.map((shot) => shot.shotPurpose)).toEqual(['establishing', 'action'])
  })

  it('rejects an empty character performance', () => {
    const plan = corePlan()
    const character = plan.shots[0]?.characters[0]
    expect(character).toBeDefined()

    expect(() => normalizeEditScriptCore({
      ...plan,
      shots: [
        {
          ...plan.shots[0],
          characters: [{ ...character!, performance: '   ' }],
        },
        plan.shots[1],
      ],
    })).toThrow()
  })

  it('projects current asset names from canonical ids', () => {
    const normalized = projectEditScriptCoreNames(corePlan(), [
      {
        kind: 'location',
        id: 'location-cabin',
        name: 'Renamed Cabin',
        description: 'Current location',
        asset: {
          id: 'location-cabin',
          previewImageUrl: null,
          hasOutput: false,
          taskTargetType: 'LocationImage',
          taskTargetId: 'location-cabin',
        },
      },
      {
        kind: 'character',
        id: 'character-anna',
        name: 'Renamed Anna',
        description: 'Current character',
        asset: {
          id: 'character-anna',
          previewImageUrl: null,
          hasOutput: false,
          taskTargetType: 'CharacterAppearance',
          taskTargetId: 'appearance-anna',
        },
      },
      {
        kind: 'character',
        id: 'character-grandmother',
        name: 'Renamed Grandmother',
        description: 'Current character',
        asset: {
          id: 'character-grandmother',
          previewImageUrl: null,
          hasOutput: false,
          taskTargetType: 'CharacterAppearance',
          taskTargetId: 'appearance-grandmother',
        },
      },
    ])

    expect(normalized.shots[0]?.scene.name).toBe('Renamed Cabin')
    expect(normalized.shots[0]?.characters.map((character) => character.name)).toEqual([
      'Renamed Anna',
      'Renamed Grandmother',
    ])
  })

  it('fails explicitly when dialogue references a speaker outside the same shot', () => {
    const plan = corePlan()
    const invalid = {
      ...plan,
      shots: [
        {
          ...plan.shots[0],
          dialogue: [{ characterId: 'character-outside', line: 'I should not be here.' }],
        },
        plan.shots[1],
      ],
    }

    expect(() => normalizeEditScriptCore(invalid))
      .toThrow('EDIT_SCRIPT_DIALOGUE_CHARACTER_UNKNOWN:1:character-outside')
  })

  it('rejects non-continuous shot numbers and unordered generation segment coverage', () => {
    const plan = corePlan()
    const nonContinuous = {
      ...plan,
      shots: [
        plan.shots[0],
        { ...plan.shots[1], shotNumber: 3 },
      ],
    }
    expect(() => normalizeEditScriptCore(nonContinuous)).toThrow('EDIT_SCRIPT_SHOT_NUMBER_NOT_CONTINUOUS')

    const reordered = {
      ...plan,
      generationSegments: [{ segmentId: 'segment-1', shotIds: ['shot-2', 'shot-1'], continuity: 'wrong order' }],
    }
    expect(() => normalizeEditScriptCore(reordered)).toThrow('EDIT_SCRIPT_GENERATION_SEGMENT_ORDER_INVALID')
  })

  it('rejects generation segments whose summed shot duration exceeds the video generation cap', () => {
    const plan = corePlan()
    const oversized = {
      ...plan,
      shots: [
        { ...plan.shots[0], durationSec: 5 },
        { ...plan.shots[1], durationSec: 5 },
        {
          ...plan.shots[1],
          shotId: 'shot-3',
          shotNumber: 3,
          shotPurpose: 'action',
          durationSec: 4,
          action: 'Anna turns the chair.',
        },
        {
          ...plan.shots[1],
          shotId: 'shot-4',
          shotNumber: 4,
          shotPurpose: 'action',
          durationSec: 3,
          action: 'The hidden subject starts to move.',
        },
      ],
      generationSegments: [
        {
          segmentId: 'segment-1',
          shotIds: ['shot-1', 'shot-2', 'shot-3', 'shot-4'],
          continuity: 'One continuous reveal movement that is too long for a single video segment.',
        },
      ],
    }

    expect(() => normalizeEditScriptCore(oversized))
      .toThrow('EDIT_SCRIPT_GENERATION_SEGMENT_DURATION_EXCEEDED:shots=shot-1,shot-2,shot-3,shot-4:duration=17:max=15')
  })
})
