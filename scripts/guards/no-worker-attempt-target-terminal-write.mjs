#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import process from 'process'

const root = process.cwd()
const guardedRoots = [
  path.join(root, 'src/lib/workers'),
  path.join(root, 'src/lib/bgm-score'),
  path.join(root, 'src/lib/soundscape'),
]
const guardedFiles = [
  path.join(root, 'src/lib/edit-script/service.ts'),
]
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])
const TARGET_TERMINAL_WRITE = /(?:status|renderStatus)\s*:\s*['"](?:failed|cancelled|canceled)['"]/

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, out)
      continue
    }
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) out.push(fullPath)
  }
  return out
}

const violations = [...guardedRoots.flatMap((guardedRoot) => walk(guardedRoot)), ...guardedFiles].flatMap((fullPath) => {
  const content = fs.readFileSync(fullPath, 'utf8')
  if (!TARGET_TERMINAL_WRITE.test(content) && !/\.catch\(\(\)\s*=>\s*undefined\)/.test(content)) return []
  return [path.relative(root, fullPath).split(path.sep).join('/')]
})

if (violations.length > 0) {
  process.stderr.write([
    '[no-worker-attempt-target-terminal-write] Worker handler target terminal write detected.',
    'TL-06B: an individual attempt cannot finalize a business target; only the unified final Task projector may do so.',
    'See docs/architecture/modules/async-task-lifecycle.md.',
    ...violations.map((violation) => `  - ${violation}`),
    '',
  ].join('\n'))
  process.exit(1)
}

process.stdout.write('[no-worker-attempt-target-terminal-write] OK\n')
