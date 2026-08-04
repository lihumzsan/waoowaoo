import { loadTestEnv } from './env'
import { runGlobalTeardown } from './global-teardown'
import { prepareFreshTestServices, waitForTestServices } from './test-services'

export default async function globalSetup() {
  loadTestEnv()

  const shouldBootstrap =
    process.env.BILLING_TEST_BOOTSTRAP === '1'
    || process.env.SYSTEM_TEST_BOOTSTRAP === '1'
    || process.env.TEMPORAL_TEST_BOOTSTRAP === '1'
  if (!shouldBootstrap) {
    return async () => {}
  }

  if (process.env.TEST_SERVICES_EXTERNAL === '1') {
    await waitForTestServices()
    return async () => {}
  }

  await prepareFreshTestServices()

  return async () => {
    await runGlobalTeardown()
  }
}
