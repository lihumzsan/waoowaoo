import { describe, expect, it } from 'vitest'
import { inspectTaskSubmissionAtomicity } from '../../../scripts/guards/task-submission-atomicity-guard.mjs'

const valid = {
  service: '',
  submitter: [
    'persistSubmittedTaskBatchInTransaction',
    'inputs: [prepared.input]',
    'onBatchCreatedInTransaction:',
  ].join('\n'),
  transactionalCreate: [
    'export async function persistSubmittedTaskBatchInTransaction',
    'params.tx.task.create',
    'prepareTaskBillingInTransaction',
    'params.tx.taskEvent.create',
    'OUTBOX_COMMAND_KIND.TASK_LIFECYCLE_BROADCAST',
    'OUTBOX_COMMAND_KIND.TASK_ENQUEUE',
    'operationExecutionId: stored.operationExecutionId',
  ].join('\n'),
  outboxTypes: 'operationExecutionId: string | null',
  enqueue: 'task.operationExecutionId !== params.operationExecutionId',
  worker: 'enqueuePersistedTask(payload)',
}

describe('Task submission atomicity guard', () => {
  it('accepts one transaction and one Outbox delivery entry', () => {
    expect(inspectTaskSubmissionAtomicity(valid)).toEqual([])
  })

  it('rejects direct queue submission after Task creation', () => {
    expect(inspectTaskSubmissionAtomicity({
      ...valid,
      submitter: `${valid.submitter}\naddTaskJob(envelope)`,
    })).toContain('generic Task submitter restores a post-create side effect: addTaskJob(')
  })
})
