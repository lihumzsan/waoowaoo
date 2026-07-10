import {
  corePlan,
  describe,
  executionPlan,
  expect,
  it,
  normalizeEditScriptCore,
  normalizeEditShotExecutionPlan,
  type EditScriptShot,
} from './normalize.fixture'

describe('shot execution plan normalization', () => {
  it('requires execution blocking to cover every core character and object', () => {
    const normalizedCore = normalizeEditScriptCore(corePlan())
    const normalizedExecution = normalizeEditShotExecutionPlan(
      executionPlan(),
      normalizedCore.shots,
      normalizedCore.generationSegments,
    )

    expect(normalizedExecution.shots).toHaveLength(2)
    expect(normalizedExecution.shots[0]?.blocking.characters.map((character) => character.name)).toEqual([
      'Anna',
      'Disguised Grandmother',
    ])
    expect(normalizedExecution.shots[0]?.blocking.axis.screenDirection).toContain('screen left')
    expect(normalizedExecution.shots[0]?.camera.lighting).toContain('shadow')
    expect(normalizedExecution.shots[0]?.videoPrompt).toContain('Single-shot video prompt')
    expect(normalizedExecution.generationSegmentExecutions[0]?.continuousVideoPrompt).toContain('Cabin reveal continuous segment')
    expect(normalizedExecution.generationSegmentExecutions[0]).toEqual({
      shotIds: ['shot-1', 'shot-2'],
      continuousVideoPrompt: expect.stringContaining('hidden subject'),
    })
  })

  it('rejects redundant generation segment continuity fields', () => {
    const normalizedCore = normalizeEditScriptCore(corePlan())
    const plan = executionPlan()
    const redundantPlan = {
      ...plan,
      generationSegmentExecutions: [
        {
          ...plan.generationSegmentExecutions[0],
          motionFlow: 'redundant split continuity field',
        },
      ],
    }

    expect(() => normalizeEditShotExecutionPlan(
      redundantPlan,
      normalizedCore.shots,
      normalizedCore.generationSegments,
    ))
      .toThrow(/Unrecognized key[\s\S]*motionFlow/)
  })

  it('normalizes copied input-only continuity and role fields before strict execution validation', () => {
    const normalizedCore = normalizeEditScriptCore(corePlan())
    const plan = executionPlan()
    const copiedInputFieldsPlan = {
      ...plan,
      shots: plan.shots.map((shot) => ({
        ...shot,
        blocking: {
          ...shot.blocking,
          characters: shot.blocking.characters.map((character) => ({
            ...character,
            role: 'copied-input-character-role',
          })),
          objects: shot.blocking.objects.map((object) => ({
            ...object,
            role: 'copied-input-object-role',
          })),
        },
      })),
      generationSegmentExecutions: plan.generationSegmentExecutions.map((segment) => ({
        shotIds: segment.shotIds,
        continuity: segment.continuousVideoPrompt,
      })),
    }

    const normalizedExecution = normalizeEditShotExecutionPlan(
      copiedInputFieldsPlan,
      normalizedCore.shots,
      normalizedCore.generationSegments,
    )

    expect(normalizedExecution.generationSegmentExecutions[0]).toEqual({
      shotIds: ['shot-1', 'shot-2'],
      continuousVideoPrompt: expect.stringContaining('Cabin reveal continuous segment'),
    })
    expect(JSON.stringify(normalizedExecution)).not.toContain('"role":')
    expect(JSON.stringify(normalizedExecution)).not.toContain('"continuity":')
  })

  it('rejects execution plans that drop in-scene characters or required objects', () => {
    const normalizedCore = normalizeEditScriptCore(corePlan())
    const missingCharacter = {
      generationSegmentExecutions: executionPlan().generationSegmentExecutions,
      shots: [
        {
          ...executionPlan().shots[0],
          blocking: {
            ...executionPlan().shots[0].blocking,
            characters: [executionPlan().shots[0].blocking.characters[0]],
          },
        },
        executionPlan().shots[1],
      ],
    }
    expect(() => normalizeEditShotExecutionPlan(
      missingCharacter,
      normalizedCore.shots as readonly EditScriptShot[],
      normalizedCore.generationSegments,
    ))
      .toThrow('EDIT_SHOT_EXECUTION_CHARACTER_MISSING')

    const missingObject = {
      generationSegmentExecutions: executionPlan().generationSegmentExecutions,
      shots: [
        {
          ...executionPlan().shots[0],
          blocking: {
            ...executionPlan().shots[0].blocking,
            objects: [],
          },
        },
        executionPlan().shots[1],
      ],
    }
    expect(() => normalizeEditShotExecutionPlan(
      missingObject,
      normalizedCore.shots as readonly EditScriptShot[],
      normalizedCore.generationSegments,
    ))
      .toThrow('EDIT_SHOT_EXECUTION_OBJECT_MISSING')
  })

  it('rejects execution plans that omit verbatim dialogue from video prompts', () => {
    const normalizedCore = normalizeEditScriptCore(corePlan())
    const plan = executionPlan()
    const missingDialogue = {
      ...plan,
      shots: [
        plan.shots[0],
        {
          ...plan.shots[1],
          videoPrompt: 'Single-shot video prompt: Anna reaches the chair without quoting the line.',
        },
      ],
    }

    expect(() => normalizeEditShotExecutionPlan(
      missingDialogue,
      normalizedCore.shots as readonly EditScriptShot[],
      normalizedCore.generationSegments,
    ))
      .toThrow('EDIT_SHOT_EXECUTION_DIALOGUE_MISSING:2:character-anna')
  })
})
