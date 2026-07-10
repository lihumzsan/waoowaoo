export const MUTATION_TARGETS = [
  'src/lib/task/retry-policy.ts',
  'src/lib/task/target-failure-sync.ts',
  'src/lib/task/job-envelope.ts',
  'src/lib/project-agent/run-state-machine.ts',
  'src/features/project-workspace/canvas/lifecycle/workspace-canvas-lifecycle.ts',
  'src/lib/query/workspace-sse-event-sequence.ts',
  'src/lib/billing/media-approval-policy.ts',
  'src/lib/project-workflow/edit-first.ts',
  'src/lib/ai-providers/fal/queue.ts',
]

const requestedTargets = process.env.MUTATION_TARGETS?.split(',').filter(Boolean)

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.mutation.config.ts',
    related: true,
  },
  mutate: requestedTargets?.length ? requestedTargets : MUTATION_TARGETS,
  coverageAnalysis: 'perTest',
  concurrency: 2,
  incremental: true,
  incrementalFile: 'reports/mutation/stryker-incremental.json',
  ignoreStatic: true,
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 80, low: 60, break: null },
  ignorePatterns: ['.next', '.tmp', 'coverage', 'data', 'public', 'reports'],
}

export default config
