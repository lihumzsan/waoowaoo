#!/usr/bin/env node

// Architecture contract: docs/architecture/modules/async-task-lifecycle.md (TL-07).

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function inspectTaskReconcilerContract(input) {
  const violations = []
  if (input.watchdogExists) {
    violations.push('scripts/watchdog.ts must not own Task recovery or lifecycle writes')
  }
  if (/dev:watchdog|start:watchdog|scripts\/watchdog\.ts/.test(input.packageJson)) {
    violations.push('package scripts must not start a second Task watchdog')
  }
  if (!input.instrumentation.includes('startTaskReconciler')) {
    violations.push('instrumentation must start the shared Task reconciler')
  }
  for (const forbidden of ['prisma.task', 'addTaskJob', 'updateMany({']) {
    if (input.instrumentation.includes(forbidden)) {
      violations.push(`instrumentation must not write or reconstruct Task state: ${forbidden}`)
    }
  }
  for (const observation of ['alive', 'terminal', 'absent', 'unavailable']) {
    if (!input.reconcile.includes(`'${observation}'`)) {
      violations.push(`Task job observation must explicitly represent ${observation}`)
    }
  }
  if (!input.reconcile.includes('buildTaskJobEnvelope')) {
    violations.push('queued Task recovery must use the shared durable job envelope')
  }
  return violations
}

function runCli() {
  const cwd = process.cwd()
  const read = (file) => fs.readFileSync(path.join(cwd, file), 'utf8')
  const violations = inspectTaskReconcilerContract({
    watchdogExists: fs.existsSync(path.join(cwd, 'scripts/watchdog.ts')),
    packageJson: read('package.json'),
    instrumentation: read('src/instrumentation.ts'),
    reconcile: read('src/lib/task/reconcile.ts'),
  })
  if (violations.length > 0) {
    console.error('[single-task-reconciler-guard] violations detected')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }
  console.log('[single-task-reconciler-guard] OK single reconciler + four-state observation + durable envelope')
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (entryHref && import.meta.url === entryHref) runCli()
