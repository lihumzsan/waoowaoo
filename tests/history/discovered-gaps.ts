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
  {
    id: 'MUT-TL-002',
    symptom: 'The first mutation baseline exposes surviving mutations in the durable Task job envelope mapper.',
    evidence: [
      'npm run test:mutation:baseline',
      'src/lib/task/job-envelope.ts',
      'tests/unit/task/job-envelope.test.ts',
    ],
    owner: 'async-task-lifecycle',
    rationale: 'The tracked baseline preserves the exact initial fingerprints while the incremental gate rejects every new survivor. Follow-up envelope scenarios must assert every billing, operation, scope, priority, and trace field rather than accepting the initial debt as a percentage target.',
    status: 'scenario-required',
  },
  {
    id: 'MUT-AR-001',
    symptom: 'The first mutation baseline exposes surviving and uncovered branches in the edit-first Workflow resolver.',
    evidence: [
      'npm run test:mutation:baseline',
      'src/lib/project-workflow/edit-first.ts',
      'tests/unit/project-workflow/edit-first-workflow.fixture.ts',
    ],
    owner: 'assistant-run-lifecycle',
    rationale: 'The resolver contains the full product-stage state space. The initial fingerprints are accepted only as explicit migration debt; new fingerprints fail the incremental gate, and subsequent scenario slices must reduce the baseline by exercising real stage transitions instead of excluding the resolver from mutation testing.',
    status: 'scenario-required',
  },
]
