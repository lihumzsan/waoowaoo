import {
  corePlan,
  describe,
  expect,
  it,
  normalizeEditScriptCore,
} from './normalize.fixture'

describe('edit-first core plan normalization', () => {
  it('normalizes the compact core plan and preserves hidden_subject characters', () => {
    const normalized = normalizeEditScriptCore(corePlan())

    expect(normalized.shotCount).toBe(2)
    expect(normalized.durationSec).toBe(6)
    expect(normalized.generationSegments).toEqual([
      {
        shotIds: ['shot-1', 'shot-2'],
        continuity: 'Anna approaches the same high-backed chair and the hidden subject stays present.',
      },
    ])
    expect(normalized.shots[0]?.characters).toContainEqual({
      characterId: 'character-grandmother',
      name: 'Disguised Grandmother',
      visibility: 'hidden',
      role: 'hidden_subject',
      performance: 'sits silently inside the high-backed chair',
    })
    expect(normalized.shots[1]?.dialogue).toEqual([
      { characterId: 'character-anna', line: 'Who is sitting there?' },
    ])
    expect(normalized.shots.map((shot) => shot.shotPurpose)).toEqual(['establishing', 'action'])
  })

  it('accepts and normalizes an empty character performance', () => {
    const plan = corePlan()
    const character = plan.shots[0]?.characters[0]
    expect(character).toBeDefined()

    const normalized = normalizeEditScriptCore({
      ...plan,
      shots: [
        {
          ...plan.shots[0],
          characters: [{ ...character!, performance: '   ' }],
        },
        plan.shots[1],
      ],
    })

    expect(normalized.shots[0]?.characters[0]?.performance).toBe('')
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
      generationSegments: [{ shotIds: ['shot-2', 'shot-1'], continuity: 'wrong order' }],
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
          shotIds: ['shot-1', 'shot-2', 'shot-3', 'shot-4'],
          continuity: 'One continuous reveal movement that is too long for a single video segment.',
        },
      ],
    }

    expect(() => normalizeEditScriptCore(oversized))
      .toThrow('EDIT_SCRIPT_GENERATION_SEGMENT_DURATION_EXCEEDED:shots=shot-1,shot-2,shot-3,shot-4:duration=17:max=15')
  })
})
