import { describe, expect, it } from 'vitest'
import {
  GOLDEN_SCENARIO_CONTRACTS,
  validateGoldenScenarioContracts,
} from '../contracts/scenarios'

describe('Golden Journey scenario contracts', () => {
  it('keeps exactly one product mainline plus the minimal security boundaries', () => {
    expect(() => validateGoldenScenarioContracts()).not.toThrow()
    expect(GOLDEN_SCENARIO_CONTRACTS.map((scenario) => scenario.id)).toEqual([
      'GJ-MAIN-STORY-TO-FINAL-DELIVERABLE',
      'GJ-AUTH-UNAUTHENTICATED-DENIAL',
      'GJ-PROJECT-CROSS-USER-ISOLATION',
      'GJ-ASSET-HUB-CROSS-PROJECT-DENIAL',
    ])
  })

  it('fails when a scenario identity is duplicated', () => {
    expect(() => validateGoldenScenarioContracts([
      GOLDEN_SCENARIO_CONTRACTS[0],
      GOLDEN_SCENARIO_CONTRACTS[0],
    ])).toThrow(/GOLDEN_SCENARIO_ID_DUPLICATE/)
  })
})
