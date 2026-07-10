import { describe, expect, it } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'
import { createScenarioExecutionLedger } from '../harness/behavior-scenario'
import { TASKTYPE_SCENARIO_REGISTRY } from './tasktype-scenario-registry'

describe('task type executable scenario registry', () => {
  it('executes every declared task contract exactly once', async () => {
    const expectedIds = TASKTYPE_SCENARIO_REGISTRY.map((scenario) => scenario.id)
    const ledger = createScenarioExecutionLedger(expectedIds)

    for (const scenario of TASKTYPE_SCENARIO_REGISTRY) {
      await scenario.execute(ledger)
    }

    expect(TASKTYPE_SCENARIO_REGISTRY).toHaveLength(Object.values(TASK_TYPE).length)
    expect(() => ledger.assertExact()).not.toThrow()
  })
})
