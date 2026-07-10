#!/usr/bin/env node

// Architecture contract: docs/architecture/modules/billing-approval.md (BA-02..BA-07).

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function inspectApprovalPlanBatchAuthority(input) {
  const violations = []
  if (/\boperationConfirmed\b/.test(input.productionSources)) {
    violations.push('legacy operationConfirmed provenance must remain deleted from production source')
  }
  for (const required of [
    'approvalGrant.updateMany',
    'tx.task.create',
    'prepareTaskBillingInTransaction',
    'OUTBOX_COMMAND_KIND.TASK_ENQUEUE',
    'transaction: Prisma.TransactionClient',
  ]) {
    if (!input.batchSubmitter.includes(required)) {
      violations.push(`approved plan batch authority is missing: ${required}`)
    }
  }
  if (!input.planning.includes('submitApprovedOperationPlanTasks')) {
    violations.push('planned Task submission must delegate to the plan-level batch authority')
  }
  if (!input.outboxTypes.includes("TASK_ENQUEUE: 'task.enqueue'")) {
    violations.push('Task enqueue responsibility must be represented by a durable Outbox command')
  }
  if (!input.outboxWorker.includes('enqueuePersistedApprovedTask(payload)')) {
    violations.push('Outbox worker must deliver approved Task enqueue commands')
  }
  for (const required of [
    'FOR UPDATE',
    "status: 'committing'",
    "status: 'completed'",
    'transaction: tx',
    'OPERATION_PLAN_ATOMIC_COMMIT_INCOMPLETE',
  ]) {
    if (!input.execution.includes(required)) {
      violations.push(`single-transaction OperationExecution authority is missing: ${required}`)
    }
  }
  for (const forbidden of ['leaseOwner', "status: 'submitted'", '9999']) {
    if (input.execution.includes(forbidden) || input.batchSubmitter.includes(forbidden)) {
      violations.push(`two-phase OperationExecution residue must be deleted: ${forbidden}`)
    }
  }
  return violations
}

function walk(root) {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name)
    if (entry.isDirectory()) return walk(target)
    return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) ? [target] : []
  })
}

function runCli() {
  const cwd = process.cwd()
  const read = (file) => fs.readFileSync(path.join(cwd, file), 'utf8')
  const productionSources = walk(path.join(cwd, 'src'))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n')
  const violations = inspectApprovalPlanBatchAuthority({
    productionSources,
    batchSubmitter: read('src/lib/task/approved-plan-submitter.ts'),
    planning: read('src/lib/operations/planning.ts'),
    outboxTypes: read('src/lib/outbox/types.ts'),
    outboxWorker: read('src/lib/workers/outbox.worker.ts'),
    execution: read('src/lib/operations/planned-operation-invocation.ts'),
  })
  if (violations.length > 0) {
    console.error('[approval-plan-batch-authority] violations detected')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }
  console.log('[approval-plan-batch-authority] OK immutable Grant + atomic Task/freeze/outbox batch')
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (entryHref && import.meta.url === entryHref) runCli()
