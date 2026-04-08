import { loadTestEnv } from './env'

export async function runGlobalTeardown() {
  loadTestEnv()
  return
}
