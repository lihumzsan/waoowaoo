#!/usr/bin/env node

// Architecture contract: docs/architecture/modules/assistant-run-lifecycle.md (AR-03/AR-03B).

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const LEGACY_CONTINUATION_SYMBOLS = [
  'reconcilePendingProjectAgentWaitsForScope',
  'listResolvedProjectAgentWaitFollowUps',
  'claimResolvedProjectAgentWaitFollowUps',
]

export function inspectProjectAgentContinuationContract(input) {
  const violations = []
  for (const symbol of LEGACY_CONTINUATION_SYMBOLS) {
    if (input.productionSources.includes(symbol)) {
      violations.push(`legacy continuation entry must remain deleted: ${symbol}`)
    }
  }
  if (input.publicControl.includes("type: 'task_follow_up'")) {
    violations.push('public Assistant control protocol must not expose task_follow_up')
  }
  for (const marker of ['/assistant/waits', '/task-follow-up', 'submitTaskFollowUp(', 'claimTaskFollowUp(']) {
    if (input.externalExecutors.includes(marker)) {
      violations.push(`non-server continuation executor must remain deleted: ${marker}`)
    }
  }
  if (!input.outboxWorker.includes('runProjectAgentWaitContinuationCommand(payload, outboxId)')) {
    violations.push('Outbox worker must be the single ProjectAgentWait continuation caller')
  }
  if (input.continuationCallers.length !== 1 || input.continuationCallers[0] !== 'src/lib/workers/outbox.worker.ts') {
    violations.push(`ProjectAgentWait continuation must have exactly one caller: ${input.continuationCallers.join(', ') || '(none)'}`)
  }
  for (const required of [
    'loadProjectAgentContinuationCheckpoint',
    'beginProjectAgentWaitContinuationExecution',
    'settleProjectAgentContinuationTerminalHandoff',
    'finalizeProjectAgentContinuationHandoff',
    "'x-request-id': params.commandId",
  ]) {
    if (!input.serverFollowUp.includes(required)) {
      violations.push(`server continuation is missing required durable step: ${required}`)
    }
  }
  for (const retired of [
    'checkpointProjectAgentWaitFollowUp',
    'finalizeProjectAgentWaitFollowUp',
    'loadProjectAgentWaitContinuationCheckpoint',
  ]) {
    if (input.serverFollowUp.includes(retired)) {
      violations.push(`server continuation must not restore split checkpoint settlement: ${retired}`)
    }
  }
  const beginIndex = input.serverFollowUp.indexOf('await beginProjectAgentWaitContinuationExecution({')
  const modelIndex = input.serverFollowUp.indexOf('await createProjectAgentChatResponse({')
  if (beginIndex < 0 || modelIndex < 0 || beginIndex >= modelIndex) {
    violations.push('server continuation must persist its at-most-once execution fence before invoking the model')
  }
  for (const required of [
    'projectAgentContinuationCheckpoint.findUnique',
    'projectAgentContinuationCheckpoint.updateMany',
    'appendProjectAssistantThreadMessagesInTransaction',
    'appendProjectAgentEventsInTransaction',
    'PROJECT_AGENT_CONTINUATION_CHECKPOINT_MISSING',
    "status: 'running'",
    "status: 'settled'",
    'prisma.$transaction',
  ]) {
    if (!input.executionHandoff.includes(required)) {
      violations.push(`Execution handoff authority is missing atomic continuation settlement: ${required}`)
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
  const sourceFiles = walk(path.join(cwd, 'src'))
  const productionSources = sourceFiles
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n')
  const continuationCallers = sourceFiles
    .filter((file) => {
      const relative = path.relative(cwd, file).split(path.sep).join('/')
      if (relative === 'src/lib/project-agent/server-follow-up.ts') return false
      return fs.readFileSync(file, 'utf8').includes('runProjectAgentWaitContinuationCommand(')
    })
    .map((file) => path.relative(cwd, file).split(path.sep).join('/'))
  const violations = inspectProjectAgentContinuationContract({
    productionSources,
    continuationCallers,
    outboxWorker: read('src/lib/workers/outbox.worker.ts'),
    serverFollowUp: read('src/lib/project-agent/server-follow-up.ts'),
    executionHandoff: read('src/lib/project-agent/execution-handoff.ts'),
    publicControl: read('src/lib/project-agent/control.ts'),
    externalExecutors: read('scripts/e2e-long-form/api-client.ts') + read('scripts/e2e-long-form/runner.ts'),
  })
  if (violations.length > 0) {
    console.error('[single-project-agent-continuation] violations detected')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }
  console.log('[single-project-agent-continuation] OK outbox-only continuation + durable checkpoint settlement')
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (entryHref && import.meta.url === entryHref) runCli()
