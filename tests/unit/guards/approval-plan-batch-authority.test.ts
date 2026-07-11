import { describe, expect, it } from 'vitest'
import { inspectApprovalPlanBatchAuthority } from '../../../scripts/guards/approval-plan-batch-authority-guard.mjs'

const valid = {
  productionSources: '',
  batchSubmitter: [
    'persistSubmittedTaskBatchInTransaction',
    'transaction: Prisma.TransactionClient',
  ].join('\n'),
  planning: 'submitApprovedOperationPlanTasks()',
  outboxTypes: "TASK_ENQUEUE: 'task.enqueue'",
  outboxWorker: 'await enqueuePersistedTask(payload)',
  execution: [
    'FOR UPDATE',
    "status: 'committing'",
    "status: 'completed'",
    'transaction: tx',
    'OPERATION_PLAN_ATOMIC_COMMIT_INCOMPLETE',
    'approvalGrant.updateMany',
  ].join('\n'),
  genericSubmitter: 'BILLABLE_MEDIA_APPROVED_PLAN_SUBMITTER_REQUIRED',
  legacyAuthorizationExists: false,
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

  it('rejects a second Grant consume writer and generic billable authorization inputs', () => {
    expect(
      inspectApprovalPlanBatchAuthority({
        ...valid,
        batchSubmitter: `${valid.batchSubmitter}\napprovalGrant.updateMany`,
        genericSubmitter: 'assertTaskApprovalAuthorization\napprovalGrantId?: string',
        legacyAuthorizationExists: true,
      }),
    ).toEqual([
      'approved plan batch submitter must not consume ApprovalGrant',
      'generic Task submitter restores billable authorization input: assertTaskApprovalAuthorization',
      'generic Task submitter restores billable authorization input: approvalGrantId?:',
      'generic Task submitter must fail closed for billable media',
      'legacy generic Task approval authorization module must remain deleted',
    ])
  })

  it('rejects an early Task-model replay path that bypasses durable bundle validation', () => {
    expect(inspectApprovalPlanBatchAuthority({
      ...valid,
      batchSubmitter: `${valid.batchSubmitter}\nconst existing = await tx.task.findMany({})`,
    })).toContain('approved plan batch submitter must not bypass the transactional Task bundle primitive')
  })
})
