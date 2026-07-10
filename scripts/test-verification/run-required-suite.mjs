#!/usr/bin/env node

import fs from 'node:fs'
import { spawnSync } from 'node:child_process'

function readOption(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const suite = readOption('--suite')
const scenarioRegistry = readOption('--scenario-registry')
const roots = process.argv.flatMap((value, index, values) => value === '--root' ? [values[index + 1]] : [])
if (!suite || roots.length === 0 || roots.some((root) => !root)) {
  throw new Error('run-required-suite requires --suite and at least one --root')
}

fs.mkdirSync('reports/test-results', { recursive: true })
const report = `reports/test-results/${suite}.json`
const vitest = spawnSync('npx', [
  'vitest', 'run', ...roots,
  '--reporter=default', '--reporter=json', `--outputFile=${report}`,
], { stdio: 'inherit', env: process.env })

const verify = spawnSync('node', [
  'scripts/test-verification/verify-vitest-report.mjs',
  '--suite', suite,
  '--report', report,
  ...roots.flatMap((root) => ['--root', root]),
], { stdio: 'inherit', env: process.env })

if (vitest.error) throw vitest.error
if (verify.error) throw verify.error
let scenarioStatus = 0
if (scenarioRegistry && vitest.status === 0 && verify.status === 0) {
  const scenarioVerify = spawnSync('node', [
    'scripts/test-verification/verify-system-journeys.mjs',
    '--report', report,
    '--registry', scenarioRegistry,
  ], { stdio: 'inherit', env: process.env })
  if (scenarioVerify.error) throw scenarioVerify.error
  scenarioStatus = scenarioVerify.status ?? 1
}
if (vitest.status !== 0 || verify.status !== 0 || scenarioStatus !== 0) process.exit(1)
