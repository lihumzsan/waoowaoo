import { describe, expect, it } from 'vitest'
import { inspectTaskAttemptOwnerContract } from '../../../scripts/guards/single-task-attempt-owner-guard.mjs'

const validService = `
  export async function tryClaimTaskAttempt(params) {
    where: { status: TASK_STATUS.QUEUED }
    data: { attempt: { increment: 1 } }
    return claimed.attempt
  }
  export async function touchTaskHeartbeat(taskId: string, attempt: number) {
    processingAttemptWhere(taskId, attempt)
  }
  export async function tryUpdateTaskProgress(
    processingAttemptWhere(taskId, attempt)
  }
`
const validWorker = `
  taskAttempt = await tryClaimTaskAttempt({ taskId })
  const maxAttempts = getTaskMaxAttempts(data.type)
  fence: { kind: 'attempt', attempt: taskAttempt }
  touchTaskHeartbeat(taskId, taskAttempt)
  tryUpdateTaskProgress(job.data.taskId, taskAttempt!, value, nextPayload)
  tryMarkTaskQueuedForRetry(taskId, currentAttempt)
`

describe('single task attempt owner guard', () => {
  it('accepts exact queued-to-processing ownership with fenced retry and terminal', () => {
    expect(inspectTaskAttemptOwnerContract({
      service: validService,
      workerLifecycle: validWorker,
    })).toEqual([])
  })

  it('rejects the legacy active-status processing claim', () => {
    expect(inspectTaskAttemptOwnerContract({
      service: 'export async function tryMarkTaskProcessing() {}',
      workerLifecycle: '',
    })).toContain('legacy processing claim entry must not exist')
  })
})
