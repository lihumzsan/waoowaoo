import { configDefaults, defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  oxc: {
    jsx: {
      runtime: 'automatic',
    },
  },
  css: {
    postcss: {
      plugins: [],
    },
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
    pool: 'forks',
    maxWorkers: 1,
    setupFiles: ['./tests/setup/env.ts'],
    globalSetup: ['./tests/setup/global-setup.ts'],
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: [...configDefaults.exclude, '**/.stryker-tmp/**', '**/.worktrees/**'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage/billing',
      include: [
        'src/lib/billing/cost.ts',
        'src/lib/billing/mode.ts',
        'src/lib/billing/task-policy.ts',
        'src/lib/billing/runtime-usage.ts',
        'src/lib/billing/service.ts',
        'src/lib/billing/ledger.ts',
      ],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
})
