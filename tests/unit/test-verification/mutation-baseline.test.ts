import { describe, expect, it } from 'vitest'
import { collectSurvivingMutants, compareMutationBaseline } from '../../../scripts/mutation/verify-baseline.mjs'

const report = {
  files: {
    'src/policy.ts': {
      mutants: [
        {
          status: 'Killed', mutatorName: 'BooleanLiteral', replacement: 'false',
          location: { start: { line: 1, column: 1 }, end: { line: 1, column: 5 } },
        },
        {
          status: 'Survived', mutatorName: 'ConditionalExpression', replacement: 'true',
          location: { start: { line: 3, column: 1 }, end: { line: 3, column: 10 } },
        },
        {
          status: 'NoCoverage', mutatorName: 'StringLiteral', replacement: '""',
          location: { start: { line: 5, column: 1 }, end: { line: 5, column: 8 } },
        },
      ],
    },
  },
}

describe('mutation baseline verification', () => {
  it('tracks survived and no-coverage mutants but not killed mutants', () => {
    expect(collectSurvivingMutants(report)).toHaveLength(2)
  })

  it('fails only for survivors absent from the accepted baseline', () => {
    const current = collectSurvivingMutants(report)
    expect(compareMutationBaseline(report, {
      acceptedFingerprints: current.map((mutant) => mutant.fingerprint),
    }).newSurvivors).toEqual([])
    expect(compareMutationBaseline(report, { acceptedFingerprints: [] }).newSurvivors).toHaveLength(2)
  })
})
