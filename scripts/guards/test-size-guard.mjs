#!/usr/bin/env node

// Architecture contract: docs/architecture/modules/test-governance.md (TG-07).

import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const MAX_LINES = 350
const MAX_CASES = 10

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function changedFiles() {
  const base = process.env.TEST_IMPACT_BASE_SHA
  const head = process.env.TEST_IMPACT_HEAD_SHA
  if (process.env.CI === 'true') {
    if (!base || !head) throw new Error('CI test size guard requires TEST_IMPACT_BASE_SHA and TEST_IMPACT_HEAD_SHA')
    return git(['diff', '--name-only', '--diff-filter=AM', `${base}...${head}`]).split('\n').filter(Boolean)
  }
  return git(['diff', '--cached', '--name-only', '--diff-filter=AM']).split('\n').filter(Boolean)
}

const testFiles = changedFiles().filter((file) => /^tests\/.*\.test\.tsx?$/.test(file) && fs.existsSync(file))
const violations = []

for (const file of testFiles) {
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/).length
  const cases = (text.match(/\b(?:it|test)\s*\(/g) ?? []).length
  if (lines > MAX_LINES || cases > MAX_CASES) {
    violations.push(`${file}: lines=${lines}/${MAX_LINES} cases=${cases}/${MAX_CASES}`)
  }
}

if (violations.length > 0) {
  console.error('[test-size-guard] changed test files exceed the responsibility boundary')
  for (const violation of violations) console.error(`  - ${violation}`)
  process.exit(1)
}

console.log(`[test-size-guard] OK changedTests=${testFiles.length}`)
