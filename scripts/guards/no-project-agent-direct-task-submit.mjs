#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import process from 'process'
import { pathToFileURL } from 'url'

const root = process.cwd()
const SCAN_ROOTS = [
  'src/lib/project-agent',
  'src/app/api/projects/[projectId]/assistant',
]
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

const DIRECT_TASK_SUBMISSION_IMPORTS = [
  /from\s+['"][^'"]*\/task-submission['"]/m,
  /from\s+['"][^'"]*\/operations\/submit-operation-task['"]/m,
  /from\s+['"][^'"]*\/task\/submitter['"]/m,
]

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

export function inspectProjectAgentDirectTaskSubmit(relPath, content) {
  if (!DIRECT_TASK_SUBMISSION_IMPORTS.some((pattern) => pattern.test(content))) return []
  return [`${relPath} imports a task submission entry; Assistant execution must use the operation registry so approval, runtime signals, and ProjectAgentWait stay bound`]
}

export function findProjectAgentDirectTaskSubmitViolations(scanRoot = root) {
  return SCAN_ROOTS
    .flatMap((relativeRoot) => walk(path.join(scanRoot, relativeRoot)))
    .flatMap((fullPath) => {
      const relPath = path.relative(scanRoot, fullPath).split(path.sep).join('/')
      return inspectProjectAgentDirectTaskSubmit(relPath, fs.readFileSync(fullPath, 'utf8'))
    })
}

export function main() {
  const violations = findProjectAgentDirectTaskSubmitViolations(root)
  if (violations.length > 0) {
    process.stderr.write([
      '[no-project-agent-direct-task-submit] Assistant task submission bypass detected.',
      'AR-04/TL-01: use a registered operation; do not submit Task from choice/runtime control code.',
      'See docs/architecture/modules/assistant-run-lifecycle.md and async-task-lifecycle.md.',
      ...violations.map((violation) => `  - ${violation}`),
      '',
    ].join('\n'))
    process.exit(1)
  }
  process.stdout.write('[no-project-agent-direct-task-submit] OK\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
