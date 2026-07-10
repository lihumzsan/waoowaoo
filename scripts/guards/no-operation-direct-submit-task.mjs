#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import process from 'process'
import { pathToFileURL } from 'url'

const root = process.cwd()
const operationsDir = path.join(root, 'src', 'lib', 'operations')
const ALLOWED_RELATIVE_PATH = 'src/lib/operations/submit-operation-task.ts'
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

const SUBMITTER_IMPORT_PATTERN =
  /import\s+[\s\S]*?\bsubmitTask\b[\s\S]*?\sfrom\s+['"][^'"]*\/task\/submitter['"]/m
const SUBMITTER_REQUIRE_PATTERN =
  /\bsubmitTask\b[\s\S]*?require\s*\(\s*['"][^'"]*\/task\/submitter['"]\s*\)/m
const SUBMIT_TASK_CALL_PATTERN = /\bsubmitTask\s*\(/m

function fail(title, details = []) {
  process.stderr.write(`\n[no-operation-direct-submit-task] ${title}\n`)
  for (const detail of details) {
    process.stderr.write(`  - ${detail}\n`)
  }
  process.stderr.write('  - TL-01: see docs/architecture/modules/async-task-lifecycle.md#不变量.\n')
  process.exit(1)
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
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

function toRel(fullPath, scanRoot = root) {
  return path.relative(scanRoot, fullPath).split(path.sep).join('/')
}

export function inspectOperationDirectSubmitTask(relPath, content) {
  if (relPath === ALLOWED_RELATIVE_PATH) return []

  const violations = []
  if (SUBMITTER_IMPORT_PATTERN.test(content) || SUBMITTER_REQUIRE_PATTERN.test(content)) {
    violations.push(`${relPath} imports submitTask directly; use submitOperationTask instead`)
  }
  if (SUBMIT_TASK_CALL_PATTERN.test(content)) {
    violations.push(`${relPath} calls submitTask directly; use submitOperationTask instead`)
  }
  return violations
}

export function findOperationDirectSubmitTaskViolations(scanRoot = root) {
  const scanOperationsDir = path.join(scanRoot, 'src', 'lib', 'operations')
  return walk(scanOperationsDir)
    .map((fullPath) => {
      const relPath = toRel(fullPath, scanRoot)
      const content = fs.readFileSync(fullPath, 'utf8')
      return inspectOperationDirectSubmitTask(relPath, content)
    })
    .flat()
}

export function main() {
  if (!fs.existsSync(operationsDir)) {
    fail('Missing src/lib/operations directory')
  }

  const violations = findOperationDirectSubmitTaskViolations(root)
  if (violations.length > 0) {
    fail('Found operation files bypassing submitOperationTask', violations)
  }

  process.stdout.write(`[no-operation-direct-submit-task] OK files=${walk(operationsDir).length}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
