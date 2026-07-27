import { describe, expect, it } from 'vitest'
import {
  GOLDEN_SCENARIO_CONTRACTS,
  validateGoldenScenarioContracts,
} from '../contracts/scenarios'

describe('Golden Journey scenario contracts', () => {
  it('keeps independent free-composition journeys and the minimal security boundaries', () => {
    expect(() => validateGoldenScenarioContracts()).not.toThrow()
    expect(GOLDEN_SCENARIO_CONTRACTS.map((scenario) => scenario.id)).toEqual([
      'GJ-FREEFORM-RESOURCE-CREATION',
      'GJ-PARALLEL-OPERATION-BATCH',
      'GJ-FREEFORM-ZERO-VIDEO',
      'GJ-ASSISTANT-STOP-REPLY',
      'GJ-AUTH-UNAUTHENTICATED-DENIAL',
      'GJ-AUTH-SESSION-RECOVERY',
      'GJ-PROJECT-CROSS-USER-ISOLATION',
      'GJ-ASSET-HUB-CROSS-PROJECT-DENIAL',
    ])
    expect(GOLDEN_SCENARIO_CONTRACTS[0]).toMatchObject({
      startState: 'empty_project',
      expectedTerminal: 'independent_resources_and_explicit_optional_projections_ready',
      requiresWorkers: true,
    })
  })

  it('fails when a scenario identity is duplicated', () => {
    expect(() => validateGoldenScenarioContracts([
      GOLDEN_SCENARIO_CONTRACTS[0],
      GOLDEN_SCENARIO_CONTRACTS[0],
    ])).toThrow(/GOLDEN_SCENARIO_ID_DUPLICATE/)
  })
})
