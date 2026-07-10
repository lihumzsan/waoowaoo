import { describe, expect, it } from 'vitest'
import { HISTORICAL_SCENARIO_REGISTRY } from '../history/scenarios/registry'
import { REQUIREMENTS_MATRIX } from './requirements-matrix'
import { ROUTE_SCENARIO_REGISTRY } from './route-scenario-registry'
import { TASKTYPE_SCENARIO_REGISTRY } from './tasktype-scenario-registry'

describe('requirements matrix integrity', () => {
  it('requirement ids are unique', () => {
    const ids = REQUIREMENTS_MATRIX.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('maps P0 requirements only to registered executable scenario ids', () => {
    const registeredIds = new Set([
      ...ROUTE_SCENARIO_REGISTRY.map((scenario) => scenario.id),
      ...TASKTYPE_SCENARIO_REGISTRY.map((scenario) => scenario.id),
      ...HISTORICAL_SCENARIO_REGISTRY.map((scenario) => scenario.id),
    ])
    for (const entry of REQUIREMENTS_MATRIX) {
      if (entry.priority === 'P0') {
        expect(entry.coverageStatus, entry.id).toBe('protected')
        expect(entry.scenarioIds.length, entry.id).toBeGreaterThan(0)
      }
      for (const scenarioId of entry.scenarioIds) {
        expect(registeredIds.has(scenarioId), `${entry.id} -> ${scenarioId}`).toBe(true)
      }
    }
  })
})
