import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { GOLDEN_SCENARIO_CONTRACTS } from '../contracts/scenarios'

const playwright = path.resolve(process.cwd(), 'node_modules/.bin/playwright')
const result = spawnSync(playwright, [
  'test',
  '--config',
  'tests/golden-journey/playwright.config.ts',
  '--list',
], {
  cwd: process.cwd(),
  encoding: 'utf8',
})
if (result.status !== 0) {
  process.stderr.write(result.stderr)
  throw new Error(`GOLDEN_PLAYWRIGHT_LIST_FAILED:${String(result.status)}`)
}
const listing = result.stdout
const missing = GOLDEN_SCENARIO_CONTRACTS
  .map((scenario) => scenario.id)
  .filter((scenarioId) => !listing.includes(`[${scenarioId}]`))
if (missing.length > 0) {
  throw new Error(`GOLDEN_SCENARIO_NOT_MOUNTED:${missing.join(',')}`)
}
process.stdout.write(`Golden Journey mounts verified: ${String(GOLDEN_SCENARIO_CONTRACTS.length)} scenarios\n`)
