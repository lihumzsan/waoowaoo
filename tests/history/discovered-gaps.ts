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
