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
    id: 'GAP-OP-001',
    symptom: 'The planned non-approval media operation returns ok=false while its existing contract expects commit success.',
    evidence: [
      'tests/unit/project-agent/tool-adapter.test.ts: planned non-approval media operation',
      'mutation dry run baseline on 2026-07-11',
    ],
    owner: 'operations-architecture',
    rationale: 'The test refactor must not change the production operation contract before the post-test remediation phase.',
    status: 'production-fix-required',
  },
  {
    id: 'GAP-SYS-001',
    symptom: 'Only image success/failure and video success are implemented as real P0 system journeys; seven required cross-layer journeys remain.',
    evidence: [
      'tests/system/generate-image.system.test.ts',
      'tests/system/generate-video.system.test.ts',
    ],
    owner: 'test-system-refactor',
    rationale: 'These journeys require new real-service system scenarios; existing integration tests cannot be relabeled as system evidence.',
    status: 'scenario-required',
  },
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
]
