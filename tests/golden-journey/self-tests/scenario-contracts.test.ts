import { describe, expect, it } from 'vitest'
import {
  GOLDEN_EDIT_FIRST_WORKFLOW_STAGES,
  GOLDEN_SCENARIO_CONTRACTS,
  GOLDEN_STAGE_COVERAGE,
  validateGoldenScenarioContracts,
} from '../contracts/scenarios'
import { GOLDEN_WORKFLOW_TRANSITIONS } from '../contracts/transitions'

describe('Golden Journey scenario contracts', () => {
  it('covers every production workflow stage with an executable scenario identity', () => {
    expect(() => validateGoldenScenarioContracts()).not.toThrow()
    expect(GOLDEN_STAGE_COVERAGE.map((coverage) => coverage.stage)).toEqual(GOLDEN_EDIT_FIRST_WORKFLOW_STAGES)
  })

  it('fails when a scenario identity is duplicated', () => {
    expect(() => validateGoldenScenarioContracts([
      GOLDEN_SCENARIO_CONTRACTS[0],
      GOLDEN_SCENARIO_CONTRACTS[0],
    ])).toThrow(/GOLDEN_SCENARIO_ID_DUPLICATE/)
  })

  it('declares one transition contract for every production workflow stage', () => {
    expect(GOLDEN_WORKFLOW_TRANSITIONS.map((transition) => transition.from)).toEqual(
      GOLDEN_EDIT_FIRST_WORKFLOW_STAGES,
    )
    expect(GOLDEN_WORKFLOW_TRANSITIONS.filter((transition) => transition.to === null).map((transition) => transition.from)).toEqual([
      'completed',
      'failed',
    ])
  })
})
