import { loadTestEnv } from './env'
import { stopTestServices } from './test-services'

export async function runGlobalTeardown() {
  loadTestEnv()

  const shouldBootstrap =
    process.env.SYSTEM_TEST_BOOTSTRAP === '1'
    || process.env.TEMPORAL_TEST_BOOTSTRAP === '1'
  if (!shouldBootstrap) return
  if (process.env.TEST_SERVICES_EXTERNAL === '1') return

  stopTestServices()
}
