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
    id: 'GJ-AR-001',
    symptom: 'A real browser consumes a valid script-review Choice after a legal Run advance and receives PROJECT_AGENT_RUN_EVENT_STALE with creation watermarks one behind the current Run.',
    evidence: [
      'tests/golden-journey/journeys/mainline-complete.spec.ts',
      'tests/golden-journey/journeys/mainline-intake.spec.ts',
      'docs/architecture/incidents/assistant-golden-journey/baseline-scan.md',
    ],
    owner: 'assistant-run-lifecycle',
    rationale: 'The existing protected Choice fence scenario did not execute the browser response after a legal intervening event. The production consume path reuses the Offer creation watermark as a current eligibility precondition.',
    status: 'production-fix-required',
  },
  {
    id: 'GJ-AR-002',
    symptom: 'When the streamed model stops after a successful tool result, the real product reaches assistant_failure instead of deterministically consuming the workflow nextAction.',
    evidence: [
      'tests/golden-journey/journeys/model-variants.spec.ts',
      'docs/architecture/incidents/assistant-golden-journey/baseline-scan.md',
    ],
    owner: 'assistant-run-lifecycle',
    rationale: 'Routing fixtures that synthesize a second model turn conceal that continuation ownership is still probabilistic in the real Agent SDK loop.',
    status: 'production-fix-required',
  },
  {
    id: 'GJ-CN-001',
    symptom: 'The real streaming workspace still reaches Maximum update depth exceeded at the ReactFlow store updater without any user selection.',
    evidence: [
      'tests/golden-journey/journeys/mainline-complete.spec.ts',
      'docs/architecture/incidents/assistant-golden-journey/baseline-scan.md',
    ],
    owner: 'canvas-node',
    rationale: 'BUG-CN-002 is marked protected, but its existing renderer-level defense does not cover the controlled ReactFlow prop/store feedback loop exercised by the full workspace.',
    status: 'production-fix-required',
  },
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
