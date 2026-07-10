#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { MUTATION_TARGETS } from '../../stryker.incremental.config.mjs'

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function changedFiles() {
  const base = process.env.TEST_IMPACT_BASE_SHA
  const head = process.env.TEST_IMPACT_HEAD_SHA
  if (process.env.CI === 'true') {
    if (!base || !head) throw new Error('CI mutation run requires TEST_IMPACT_BASE_SHA and TEST_IMPACT_HEAD_SHA')
    return git(['diff', '--name-only', `${base}...${head}`]).split('\n').filter(Boolean)
  }
  return git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean)
}

const changed = new Set(changedFiles())
const selected = MUTATION_TARGETS.filter((target) => changed.has(target))
if (selected.length === 0) {
  console.log('[mutation-incremental] OK no changed critical mutation targets')
  process.exit(0)
}

console.log(`[mutation-incremental] targets=${selected.join(',')}`)
execFileSync('npx', ['stryker', 'run', 'stryker.incremental.config.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, MUTATION_TARGETS: selected.join(',') },
})
execFileSync('node', [
  'scripts/mutation/verify-baseline.mjs',
  '--report', 'reports/mutation/mutation.json',
  '--baseline', 'tests/mutation/baseline.json',
], { stdio: 'inherit' })
