// Architecture contract: docs/architecture/modules/assistant-run-lifecycle.md

import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import { assertAssistantToolWriteAuthority } from '@/lib/operations/write-authority'

const writes = Object.values(createProjectAgentOperationRegistry())
  .filter((operation) => operation.channels.tool && operation.effects.writes)

for (const operation of writes) {
  assertAssistantToolWriteAuthority(
    operation.id,
    operation as unknown as Record<string, unknown>,
  )
}

const summary = {
  total: writes.length,
  billablePlanCommit: writes.filter((operation) => operation.confirmation.kind === 'billable_media').length,
  transactionalExecute: writes.filter((operation) => typeof operation.executeInTransaction === 'function').length,
  transactionalTaskSubmission: writes.filter(
    (operation) => operation.assistantWriteAuthority?.kind === 'transactional_task_submission',
  ).length,
}

if (
  summary.total
  !== summary.billablePlanCommit
    + summary.transactionalExecute
    + summary.transactionalTaskSubmission
) {
  throw new Error(`PROJECT_AGENT_OPERATION_WRITE_AUTHORITY_NOT_EXHAUSTIVE:${JSON.stringify(summary)}`)
}

process.stdout.write(`[operation-write-authority-registry] OK ${JSON.stringify(summary)}\n`)
process.exit(0)
