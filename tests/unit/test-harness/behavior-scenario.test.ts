import { describe, expect, it } from 'vitest'
import { createScenarioExecutionLedger } from '../../harness/behavior-scenario'

describe('behavior scenario execution ledger', () => {
  it('accepts exactly one execution of every declared scenario', () => {
    const ledger = createScenarioExecutionLedger(['SCENARIO-A', 'SCENARIO-B'])
    ledger.recordExecution('SCENARIO-B')
    ledger.recordExecution('SCENARIO-A')

    expect(ledger.compare()).toEqual({ missing: [], unexpected: [], duplicates: [] })
    expect(() => ledger.assertExact()).not.toThrow()
  })

  it('reports missing, unexpected, and duplicate executions as distinct contract failures', () => {
    const ledger = createScenarioExecutionLedger(['SCENARIO-A', 'SCENARIO-B'])
    ledger.recordExecution('SCENARIO-A')
    ledger.recordExecution('SCENARIO-A')
    ledger.recordExecution('SCENARIO-C')

    expect(ledger.compare()).toEqual({
      missing: ['SCENARIO-B'],
      unexpected: ['SCENARIO-C'],
      duplicates: ['SCENARIO-A'],
    })
    expect(() => ledger.assertExact()).toThrow('Scenario execution mismatch')
  })
})
