import { describe, expect, it } from 'vitest'
import { inspectApprovalPlanBatchAuthority } from '../../../scripts/guards/approval-plan-batch-authority-guard.mjs'

const valid = {
  productionSources: '',
  batchSubmitter: [
    'approvalGrant.updateMany',
    'tx.task.create',
    'prepareTaskBillingInTransaction',
    'OUTBOX_COMMAND_KIND.TASK_ENQUEUE',
    'transaction: Prisma.TransactionClient',
  ].join('\n'),
  planning: 'submitApprovedOperationPlanTasks()',
  outboxTypes: "TASK_ENQUEUE: 'task.enqueue'",
  outboxWorker: 'await enqueuePersistedApprovedTask(payload)',
  execution: [
    'FOR UPDATE',
    "status: 'committing'",
    "status: 'completed'",
    'transaction: tx',
    'OPERATION_PLAN_ATOMIC_COMMIT_INCOMPLETE',
  ].join('\n'),
}

describe('approval plan batch authority guard', () => {
  it('accepts the immutable plan-level atomic submission path', () => {
    expect(inspectApprovalPlanBatchAuthority(valid)).toEqual([])
  })

  it('rejects legacy boolean provenance and per-Task submission without the batch authority', () => {
    expect(
      inspectApprovalPlanBatchAuthority({
        ...valid,
        productionSources: 'operationConfirmed: true',
        planning: 'submitOperationTask()',
      }),
    ).toEqual([
      'legacy operationConfirmed provenance must remain deleted from production source',
      'planned Task submission must delegate to the plan-level batch authority',
    ])
  })

  it('rejects two-phase lease, submitted status, and future-date staging residue', () => {
    expect(
      inspectApprovalPlanBatchAuthority({
        ...valid,
        execution: `${valid.execution}\nleaseOwner\nstatus: 'submitted'\n9999`,
      }),
    ).toEqual([
      'two-phase OperationExecution residue must be deleted: leaseOwner',
      "two-phase OperationExecution residue must be deleted: status: 'submitted'",
      'two-phase OperationExecution residue must be deleted: 9999',
    ])
  })
})
