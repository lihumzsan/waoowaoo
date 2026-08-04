import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import {
  applySecurityRuntimeIdentity,
  resolveSecurityRuntimeIdentity,
} from './runtime/identity'

const externalEnvironment = process.env.SECURITY_EXTERNAL_ENV === '1'
const runtimeIdentity = resolveSecurityRuntimeIdentity()
if (!externalEnvironment) applySecurityRuntimeIdentity(runtimeIdentity)
const artifactRoot = path.resolve(
  process.cwd(),
  process.env.SECURITY_ARTIFACT_ROOT ?? runtimeIdentity.artifactRoot,
)
process.env.NO_PROXY = '127.0.0.1,localhost'
process.env.no_proxy = '127.0.0.1,localhost'

export default defineConfig({
  testDir: path.resolve(process.cwd(), 'tests/browser-security/specs'),
  globalTeardown: path.resolve(process.cwd(), 'tests/browser-security/runtime/global-teardown.ts'),
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
  webServer: externalEnvironment
    ? undefined
    : {
      command: 'exec node --import=tsx tests/browser-security/runtime/start-environment.ts',
      cwd: process.cwd(),
      url: `http://127.0.0.1:${String(runtimeIdentity.appPort)}/zh/auth/signin`,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    baseURL: process.env.SECURITY_BASE_URL
      ?? `http://127.0.0.1:${String(runtimeIdentity.appPort)}`,
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
