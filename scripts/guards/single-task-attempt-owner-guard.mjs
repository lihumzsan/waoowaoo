#!/usr/bin/env node

// Architecture contract: docs/architecture/modules/async-task-lifecycle.md (TL-02A).

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function inspectTaskAttemptOwnerContract(input) {
  const violations = []
  for (const required of [
    'export async function tryClaimTaskAttempt',
    'export async function touchTaskHeartbeat(taskId: string, attempt: number)',
    'export async function tryUpdateTaskProgress(',
    'processingAttemptWhere(taskId, attempt)',
    'status: TASK_STATUS.QUEUED',
    'attempt: { increment: 1 }',
    "kind: 'claimed'",
    "kind: 'already_processing'",
    "kind: 'terminal'",
    "kind: 'missing'",
  ]) {
    if (!input.service.includes(required)) {
      violations.push(`Task attempt claim is missing CAS contract: ${required}`)
    }
  }
  if (input.workerLifecycle.includes('job.attemptsMade')) {
    violations.push('BullMQ attemptsMade must not own durable Task retry or terminal semantics')
  }
  if (/tryMarkTaskProcessing|markTaskProcessing/.test(input.service)) {
    violations.push('legacy processing claim entry must not exist')
  }
  for (const required of [
    'const claim = await tryClaimTaskAttempt({ taskId })',
    "if (claim.kind === 'already_processing')",
    'throw new UnrecoverableError(`TASK_ATTEMPT_ALREADY_PROCESSING:',
    'taskAttempt = claim.attempt',
    'const maxAttempts = getTaskMaxAttempts(data.type)',
    "fence: { kind: 'attempt', attempt: taskAttempt }",
    'touchTaskHeartbeat(taskId, taskAttempt)',
    'tryUpdateTaskProgress(job.data.taskId, taskAttempt!',
    'tryMarkTaskQueuedForRetry(taskId, currentAttempt)',
  ]) {
    if (!input.workerLifecycle.includes(required)) {
      violations.push(`worker lifecycle is missing attempt ownership fence: ${required}`)
    }
  }
  return violations
}

function runCli() {
  const root = process.cwd()
  const violations = inspectTaskAttemptOwnerContract({
    service: fs.readFileSync(path.join(root, 'src/lib/task/service.ts'), 'utf8'),
    workerLifecycle: fs.readFileSync(path.join(root, 'src/lib/workers/shared.ts'), 'utf8'),
  })
  if (violations.length > 0) {
    console.error('[single-task-attempt-owner] violations detected')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }
  console.log('[single-task-attempt-owner] OK queued/attempt CAS + fenced retry/terminal')
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (entryHref && import.meta.url === entryHref) runCli()
