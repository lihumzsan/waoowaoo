#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import process from 'process'

const root = process.cwd()
const SOURCE_ROOT = path.join(root, 'src')
const FORBIDDEN_PATHS = [
  'src/lib/plan-run-runtime',
  'src/app/api/plan-runs',
  'src/lib/operations/domains/run/run-ops.ts',
]
const FORBIDDEN_MARKERS = [
  'plan-run-runtime',
  '/api/plan-runs',
  'list_plan_runs',
  'create_plan_run',
  'get_plan_run_snapshot',
  'list_plan_run_events',
  'cancel_plan_run',
  'retry_plan_step',
  'activePlanRuns',
  'activePlanRunCount',
]
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === '.next' || entry.name === 'node_modules') continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, out)
      continue
    }
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) out.push(fullPath)
  }
  return out
}

const violations = []
for (const relativePath of FORBIDDEN_PATHS) {
  const absolutePath = path.join(root, relativePath)
  if (
    fs.existsSync(absolutePath)
    && (fs.statSync(absolutePath).isFile() || walk(absolutePath).length > 0)
  ) {
    violations.push(`${relativePath} restores the retired PlanRun execution surface`)
  }
}

for (const fullPath of walk(SOURCE_ROOT)) {
  const content = fs.readFileSync(fullPath, 'utf8')
  const relativePath = path.relative(root, fullPath).split(path.sep).join('/')
  for (const marker of FORBIDDEN_MARKERS) {
    if (content.includes(marker)) {
      violations.push(`${relativePath} contains retired PlanRun marker ${JSON.stringify(marker)}`)
    }
  }
}

if (violations.length > 0) {
  process.stderr.write([
    '[no-plan-run-runtime] Retired PlanRun execution surface detected.',
    'AR-01/AR-04: Assistant execution must use the project-agent runtime and unified Operation/Task/Wait lifecycle.',
    'See docs/architecture/modules/assistant-run-lifecycle.md.',
    ...violations.map((violation) => `  - ${violation}`),
    '',
  ].join('\n'))
  process.exit(1)
}

process.stdout.write('[no-plan-run-runtime] OK\n')
