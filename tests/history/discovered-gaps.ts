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
  {
    id: 'GAP-I18N-001',
    symptom: 'LocationSection unit rendering reports missing zh messages for assets.overview prop asset labels.',
    evidence: [
      'tests/unit/components/location-section-prop-confirm.test.ts full-suite stderr',
      'missing keys: assets.overview.propAssets and assets.overview.propCounts',
    ],
    owner: 'workspace-assets',
    rationale: 'Missing production i18n messages are outside the test-system refactor ownership boundary and must fail visibly in the later production remediation slice.',
    status: 'production-fix-required',
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
