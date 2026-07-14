import {
  corePlan,
  describe,
  executionPlan,
  expect,
  it,
  normalizeEditScriptCore,
  normalizeEditShotExecutionPlan,
} from './normalize.fixture'

describe('shot execution plan normalization', () => {
  it('keeps execution output limited to shot scale and camera movement', () => {
    const normalizedCore = normalizeEditScriptCore(corePlan())
    const normalized = normalizeEditShotExecutionPlan(
      executionPlan(),
      normalizedCore.shots,
      normalizedCore.generationSegments,
    )

    expect(normalized.generationSegments).toEqual([{
      segmentId: 'segment-1',
      shots: [
        {
          shotId: 'shot-1',
          shotNumber: 1,
          shotScale: 'medium',
          cameraMovement: { movement: 'locked off', stability: 'locked' },
        },
        {
          shotId: 'shot-2',
          shotNumber: 2,
          shotScale: 'medium close',
          cameraMovement: { movement: 'slow push', stability: 'smooth' },
        },
      ],
    }])
  })

  it('rejects removed execution fields instead of silently accepting them', () => {
    const normalizedCore = normalizeEditScriptCore(corePlan())
    const plan = executionPlan()
    const withLighting = {
      generationSegments: [{ ...plan.generationSegments[0], lighting: 'forbidden' }],
    }

    expect(() => normalizeEditShotExecutionPlan(
      withLighting,
      normalizedCore.shots,
      normalizedCore.generationSegments,
    )).toThrow(/Unrecognized key[\s\S]*lighting/)
  })

  it('rejects execution plans that drop a core shot', () => {
    const normalizedCore = normalizeEditScriptCore(corePlan())
    const segment = executionPlan().generationSegments[0]
    const missingShot = {
      generationSegments: [{ ...segment, shots: [segment.shots[0]] }],
    }

    expect(() => normalizeEditShotExecutionPlan(
      missingShot,
      normalizedCore.shots,
      normalizedCore.generationSegments,
    )).toThrow('EDIT_SHOT_EXECUTION_PLAN_COVERAGE_INVALID')
  })

  it('rejects unknown movement stability values', () => {
    const normalizedCore = normalizeEditScriptCore(corePlan())
    const segment = executionPlan().generationSegments[0]
    const invalidStability = {
      generationSegments: [{
        ...segment,
        shots: segment.shots.map((shot) => ({
          ...shot,
          cameraMovement: { ...shot.cameraMovement, stability: 'cinematic' },
        })),
      }],
    }

    expect(() => normalizeEditShotExecutionPlan(
      invalidStability,
      normalizedCore.shots,
      normalizedCore.generationSegments,
    )).toThrow()
  })
})
