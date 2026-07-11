#!/usr/bin/env node

// Architecture contracts:
// - docs/architecture/modules/async-task-lifecycle.md (TL-10)
// - docs/architecture/modules/billing-approval.md (BA-13)

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

export function inspectSingleTaskBillingOwner(input) {
  const violations = []
  for (const removed of ['prepareTaskBilling', 'settleTaskBilling', 'rollbackTaskBilling', 'authorizeTaskBilling']) {
    if (input.service.includes(`export async function ${removed}(`)) {
      violations.push(`non-transaction Task billing writer must stay deleted: ${removed}`)
    }
    if (input.index.includes(`  ${removed},`)) {
      violations.push(`billing index must not export legacy Task writer: ${removed}`)
    }
  }
  for (const required of [
    'prepareTaskBillingInTransaction',
    'settleTaskBillingInTransaction',
    'rollbackTaskBillingInTransaction',
    'if (getLogContext().taskId) return await execute()',
  ]) {
    if (!input.service.includes(required)) violations.push(`Task billing authority missing: ${required}`)
  }
  for (const required of ['settleTaskBillingInTransaction', 'rollbackTaskBillingInTransaction']) {
    if (!input.terminal.includes(required)) violations.push(`Terminal Service does not own Task billing: ${required}`)
  }
  if (!input.transactionalCreate.includes('prepareTaskBillingInTransaction')) {
    violations.push('Task creation transaction does not own billing preparation')
  }
  return violations
}

function runCli() {
  const root = process.cwd()
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
  const violations = inspectSingleTaskBillingOwner({
    service: read('src/lib/billing/service.ts'),
    index: read('src/lib/billing/index.ts'),
    terminal: read('src/lib/task/terminal/service.ts'),
    transactionalCreate: read('src/lib/task/transactional-create.ts'),
  })
  if (violations.length > 0) {
    console.error('[single-task-billing-owner] violations detected')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }
  console.log('[single-task-billing-owner] OK Task billing writes stay transaction-owned')
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (entryHref && import.meta.url === entryHref) runCli()
