import { configDefaults, defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  css: {
    postcss: { plugins: [] },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@skills': resolve(__dirname, 'skills'),
    },
  },
  test: {
    environment: 'node',
    css: false,
    setupFiles: ['./tests/setup/env.ts'],
    include: [
      'tests/unit/**/*.test.ts',
      'tests/contracts/**/*.test.ts',
      'tests/integration/provider/**/*.test.ts',
      'tests/regression/historical-defect-scenarios.test.ts',
    ],
    exclude: [
      ...configDefaults.exclude,
      '**/.stryker-tmp/**',
      'tests/unit/project-agent/tool-adapter.test.ts',
    ],
    pool: 'forks',
    poolOptions: { forks: { minForks: 1, maxForks: 1 } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
