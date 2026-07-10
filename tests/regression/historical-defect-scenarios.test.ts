import { describe, expect, it } from 'vitest'
import { createScenarioExecutionLedger } from '../harness/behavior-scenario'
import { HISTORICAL_DEFECT_CATALOG } from '../history/catalog'
import { HISTORICAL_SCENARIO_REGISTRY } from '../history/scenarios/registry'

describe('historical defect executable scenarios', () => {
  it('proves fail-before and pass-after for every cataloged P0/P1 scenario', async () => {
    const expectedIds = HISTORICAL_DEFECT_CATALOG
      .filter((defect) => defect.severity === 'P0' || defect.severity === 'P1')
      .flatMap((defect) => defect.scenarioIds)
      .sort()
    const registeredIds = HISTORICAL_SCENARIO_REGISTRY.map((scenario) => scenario.id).sort()
    expect(registeredIds).toEqual(expectedIds)

    const ledger = createScenarioExecutionLedger(expectedIds)
    for (const scenario of HISTORICAL_SCENARIO_REGISTRY) {
      await scenario.verifyFailBefore()
      await scenario.execute(ledger)
    }

    expect(() => ledger.assertExact()).not.toThrow()
  }, 120_000)
})
