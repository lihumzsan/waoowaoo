import { describe, expect, it, vi } from 'vitest'
import { resolveWorkflowRunId } from '@/lib/workers/handlers/workflow-run-id'

describe('resolveWorkflowRunId', () => {
  it('recovers a missing payload run id from the graph run linked to the task', async () => {
    const findRunIdByTaskId = vi.fn(async () => 'run-from-task')

    const runId = await resolveWorkflowRunId({
      payload: { content: 'story without run metadata' },
      taskId: 'task-1',
      findRunIdByTaskId,
    })

    expect(runId).toBe('run-from-task')
    expect(findRunIdByTaskId).toHaveBeenCalledWith('task-1')
  })

  it('uses the payload run id without querying the database', async () => {
    const findRunIdByTaskId = vi.fn(async () => 'unexpected-run')

    const runId = await resolveWorkflowRunId({
      payload: { runId: 'run-from-payload' },
      taskId: 'task-1',
      findRunIdByTaskId,
    })

    expect(runId).toBe('run-from-payload')
    expect(findRunIdByTaskId).not.toHaveBeenCalled()
  })
})
