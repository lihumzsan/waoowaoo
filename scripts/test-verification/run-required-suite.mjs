#!/usr/bin/env node

import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const packageRequire = createRequire(import.meta.url)

function resolvePackageBinary(packageName, binaryName) {
  const packageJsonPath = packageRequire.resolve(`${packageName}/package.json`)
  const manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  const bin = manifest?.bin
  const relativeBinary = typeof bin === 'string' ? bin : bin?.[binaryName]
  if (typeof relativeBinary !== 'string' || relativeBinary.length === 0) {
    throw new Error(`PACKAGE_BINARY_UNRESOLVED:${packageName}:${binaryName}`)
  }
  return path.resolve(path.dirname(packageJsonPath), relativeBinary)
}

function readOption(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const suite = readOption('--suite')
const roots = process.argv.flatMap((value, index, values) => value === '--root' ? [values[index + 1]] : [])
if (!suite || roots.length === 0 || roots.some((root) => !root)) {
  throw new Error('run-required-suite requires --suite and at least one --root')
}

fs.mkdirSync('reports/test-results', { recursive: true })
const report = `reports/test-results/${suite}.json`
const vitest = spawnSync(process.execPath, [
  resolvePackageBinary('vitest', 'vitest'), 'run', ...roots,
  '--reporter=default', '--reporter=json', `--outputFile=${report}`,
], { stdio: 'inherit', env: process.env })

const verify = spawnSync(process.execPath, [
  'scripts/test-verification/verify-vitest-report.mjs',
  '--suite', suite,
  '--report', report,
  ...roots.flatMap((root) => ['--root', root]),
], { stdio: 'inherit', env: process.env })

if (vitest.error) throw vitest.error
if (verify.error) throw verify.error
if (vitest.status !== 0 || verify.status !== 0) process.exit(1)
