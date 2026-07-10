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
    id: 'MUT-TL-001',
    symptom: 'The first mutation baseline exposes surviving and uncovered mutations in the Task target terminal projector.',
    evidence: [
      'npm run test:mutation:baseline',
      'src/lib/task/target-failure-sync.ts',
      'tests/unit/task/target-failure-sync.test.ts',
    ],
    owner: 'async-task-lifecycle',
    rationale: 'The projector is a database-backed terminal boundary with multiple target-specific CAS branches. The first baseline records existing mutation debt; each subsequent changed-target run rejects fingerprints not present in the tracked baseline. Follow-up scenarios must reduce this set without weakening terminal ownership guards.',
    status: 'scenario-required',
  },
]
