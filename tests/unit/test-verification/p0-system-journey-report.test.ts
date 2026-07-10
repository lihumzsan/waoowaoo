import { describe, expect, it } from 'vitest'
import {
  compareSystemJourneyExecution,
  validateSystemJourneyRegistry,
} from '../../../scripts/test-verification/verify-system-journeys.mjs'
import {
  P0_SYSTEM_JOURNEY_REGISTRY,
  validateP0SystemJourneyRegistry,
} from '../../system/p0-journey-registry'

const registry = Array.from({ length: 10 }, (_, index) => ({
  id: `SYS-${index}`,
  status: index === 0 ? 'protected' : 'scenario-required',
}))

function report(names: readonly string[]) {
  return {
    testResults: [{
      assertionResults: names.map((fullName) => ({ fullName, status: 'passed' })),
    }],
  }
}

describe('P0 system journey report verification', () => {
  it('accepts each protected runtime scenario exactly once', () => {
    expect(compareSystemJourneyExecution(report(['journey [P0:SYS-0]']), registry)).toMatchObject({
      missing: [], unexpected: [], duplicates: [],
    })
  })

  it('rejects missing, duplicate, unknown, and not-yet-protected runtime ids', () => {
    expect(compareSystemJourneyExecution(report([]), registry).missing).toEqual(['SYS-0'])
    expect(compareSystemJourneyExecution(report(['[P0:SYS-0]', '[P0:SYS-0]']), registry).duplicates).toEqual(['SYS-0'])
    expect(compareSystemJourneyExecution(report(['[P0:SYS-1]', '[P0:SYS-X]']), registry).unexpected).toEqual(['SYS-1', 'SYS-X'])
  })

  it('keeps the typed and runtime registries exhaustive and valid', () => {
    expect(() => validateP0SystemJourneyRegistry()).not.toThrow()
    expect(() => validateSystemJourneyRegistry(P0_SYSTEM_JOURNEY_REGISTRY)).not.toThrow()
  })
})
