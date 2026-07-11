#!/usr/bin/env node

// Architecture contracts:
// - docs/architecture/modules/async-task-lifecycle.md (TL-01, TL-04, TL-08)
// - docs/architecture/modules/billing-approval.md (BA-13)

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

export function inspectTaskSubmissionAtomicity(input) {
  const violations = []
  if (input.service.includes('export async function createTask')) {
    violations.push('legacy bare Task creator must remain deleted')
  }
  for (const required of [
    'persistSubmittedTaskBatchInTransaction',
    'inputs: [prepared.input]',
    'onBatchCreatedInTransaction:',
  ]) {
    if (!input.submitter.includes(required)) {
      violations.push(`generic Task submitter is missing atomic persistence delegation: ${required}`)
    }
  }
  for (const forbidden of [
    'addTaskJob(',
    'publishTaskEvent(',
    'authorizeTaskBilling(',
    'markTaskEnqueued(',
    'markTaskEnqueueFailed(',
  ]) {
    if (input.submitter.includes(forbidden)) {
      violations.push(`generic Task submitter restores a post-create side effect: ${forbidden}`)
    }
  }
  for (const required of [
    'export async function persistSubmittedTaskBatchInTransaction',
    'params.tx.task.create',
    'prepareTaskBillingInTransaction',
    'params.tx.taskEvent.create',
    'OUTBOX_COMMAND_KIND.TASK_LIFECYCLE_BROADCAST',
    'OUTBOX_COMMAND_KIND.TASK_ENQUEUE',
    'operationExecutionId: stored.operationExecutionId',
  ]) {
    if (!input.transactionalCreate.includes(required)) {
      violations.push(`transactional Task primitive is incomplete: ${required}`)
    }
  }
  if (!input.outboxTypes.includes('operationExecutionId: string | null')) {
    violations.push('task.enqueue must explicitly distinguish generic and approved execution authority')
  }
  if (!input.enqueue.includes('task.operationExecutionId !== params.operationExecutionId')) {
    violations.push('task.enqueue consumer must fence the persisted execution authority')
  }
  if (!input.worker.includes('enqueuePersistedTask(payload)')) {
    violations.push('Outbox worker must be the delivery entry for every task.enqueue command')
  }
  return violations
}

function runCli() {
  const root = process.cwd()
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
  const violations = inspectTaskSubmissionAtomicity({
    submitter: read('src/lib/task/submitter.ts'),
    transactionalCreate: read('src/lib/task/transactional-create.ts'),
    outboxTypes: read('src/lib/outbox/types.ts'),
    enqueue: read('src/lib/task/enqueue.ts'),
    worker: read('src/lib/workers/outbox.worker.ts'),
    service: read('src/lib/task/service.ts'),
  })
  if (violations.length > 0) {
    console.error('[task-submission-atomicity] violations detected')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }
  console.log('[task-submission-atomicity] OK Task + billing + event + enqueue Outbox transaction')
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (entryHref && import.meta.url === entryHref) runCli()
