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
    'persistSubmittedTaskBatchInTransaction',
    'transaction: Prisma.TransactionClient',
  ]) {
    if (!input.batchSubmitter.includes(required)) {
      violations.push(`approved plan batch authority is missing: ${required}`)
    }
  }
  if (!input.planning.includes('submitApprovedOperationPlanTasks')) {
    violations.push('planned Task submission must delegate to the plan-level batch authority')
  }
  if (input.batchSubmitter.includes('approvalGrant.updateMany')) {
    violations.push('approved plan batch submitter must not consume ApprovalGrant')
  }
  if (/\b(?:tx|params\.transaction)\.task\.(?:find|create|update|upsert|delete)/.test(input.batchSubmitter)) {
    violations.push('approved plan batch submitter must not bypass the transactional Task bundle primitive')
  }
  const grantConsumeWriterCount = input.execution.match(/approvalGrant\.updateMany/g)?.length ?? 0
  if (grantConsumeWriterCount !== 1) {
    violations.push(`invokeApprovedOperationPlan must be the single ApprovalGrant consume writer; found ${grantConsumeWriterCount}`)
  }
  for (const forbidden of [
    'assertTaskApprovalAuthorization',
    'approvalGrantId?:',
    'operationExecutionId?:',
    'operationPlanTaskId?:',
  ]) {
    if (input.genericSubmitter.includes(forbidden)) {
      violations.push(`generic Task submitter restores billable authorization input: ${forbidden}`)
    }
  }
  if (!input.genericSubmitter.includes('BILLABLE_MEDIA_APPROVED_PLAN_SUBMITTER_REQUIRED')) {
    violations.push('generic Task submitter must fail closed for billable media')
  }
  if (input.legacyAuthorizationExists) {
    violations.push('legacy generic Task approval authorization module must remain deleted')
  }
  if (!input.outboxTypes.includes("TASK_ENQUEUE: 'task.enqueue'")) {
    violations.push('Task enqueue responsibility must be represented by a durable Outbox command')
  }
  if (!input.outboxWorker.includes('enqueuePersistedTask(payload)')) {
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
    genericSubmitter: read('src/lib/task/submitter.ts'),
    legacyAuthorizationExists: fs.existsSync(path.join(cwd, 'src/lib/task/approval-authorization.ts')),
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
