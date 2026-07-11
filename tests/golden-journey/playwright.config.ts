import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const artifactRoot = path.resolve(process.cwd(), 'artifacts/golden-journey')
process.env.NO_PROXY = '127.0.0.1,localhost'
process.env.no_proxy = '127.0.0.1,localhost'

export default defineConfig({
  testDir: path.resolve(process.cwd(), 'tests/golden-journey/journeys'),
  outputDir: path.join(artifactRoot, 'test-output'),
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(artifactRoot, 'playwright-results.json') }],
    ['html', { outputFolder: path.join(artifactRoot, 'html'), open: 'never' }],
  ],
  webServer: process.env.GOLDEN_EXTERNAL_ENV === '1'
    ? undefined
    : {
      command: 'tsx tests/golden-journey/runtime/start-environment.ts',
      cwd: process.cwd(),
      url: 'http://127.0.0.1:3199/health',
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  use: {
    baseURL: process.env.GOLDEN_BASE_URL ?? 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
    },
  }],
})
