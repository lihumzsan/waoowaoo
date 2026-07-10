export type DiscoveredTestGap = {
  readonly id: string
  readonly symptom: string
  readonly evidence: readonly string[]
  readonly owner: string
  readonly rationale: string
  readonly status: 'production-fix-required' | 'scenario-required'
}

export const DISCOVERED_TEST_GAPS: readonly DiscoveredTestGap[] = [
  {
    id: 'GAP-MUT-001',
    symptom: 'The initial critical-module mutation baseline contains 203 survived and 144 no-coverage mutants.',
    evidence: [
      'tests/mutation/baseline.json',
      'reports/mutation/mutation.json: 755 total, 408 killed, 203 survived, 144 no coverage',
    ],
    owner: 'test-system-refactor',
    rationale: 'The first run establishes a non-arbitrary baseline; Provider, Canvas, job envelope, and target failure survivors must be burned down in later test slices.',
    status: 'scenario-required',
  },
  {
    id: 'GAP-CLEANUP-001',
    symptom: 'Forty existing test files still exceed the 350-line or 10-case responsibility boundary.',
    evidence: [
      'initial test-size audit on 2026-07-11: 40 legacy oversized files',
      'scripts/guards/test-size-guard.mjs now prevents changed files from preserving this debt',
    ],
    owner: 'test-system-refactor',
    rationale: 'Bulk splitting all legacy suites in the same infrastructure change would create review noise; each file must split when its behavior slice is migrated.',
    status: 'scenario-required',
  },
]
