#!/usr/bin/env node

// Architecture contract: docs/architecture/modules/test-governance.md (TG-07).

import fs from 'node:fs'
import path from 'node:path'

const MAX_LINES = 350
const MAX_CASES = 10

function discoverTestFiles(directory) {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...discoverTestFiles(entryPath))
      continue
    }
    if (/\.test\.tsx?$/.test(entry.name)) files.push(entryPath)
  }
  return files
}

const testFiles = discoverTestFiles('tests').sort()
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
  console.error('[test-size-guard] test files exceed the responsibility boundary')
  for (const violation of violations) console.error(`  - ${violation}`)
  process.exit(1)
}

console.log(`[test-size-guard] OK testFiles=${testFiles.length}`)
