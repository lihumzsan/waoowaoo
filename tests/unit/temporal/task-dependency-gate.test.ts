import { describe, expect, it } from 'vitest'
import {
  resolveRequiredSuccessDependencyDecision,
  retainSchedulerCompletions,
  type SchedulerDependencyCompletion,
} from '@/lib/temporal/task/dependency-gate'
import {
  sameScheduledTask,
  validateTaskSchedulerAdmissionDependencies,
} from '@/lib/temporal/task/scheduled-request'

const request = (dependsOnTaskIds: readonly string[]) => ({
  enqueueId: 'enqueue:target',
  task: {
    workflowId: 'task:target',
    schedulerWorkflowId: 'user-task-scheduler:user-1',
    taskId: 'target',
    userId: 'user-1',
    taskType: 'workspace_resource_video_merge' as const,
  },
  dependsOnTaskIds,
})

const summary = (
  taskId: string,
  status: 'completed' | 'failed',
): SchedulerDependencyCompletion => ({
  taskId,
  taskWorkflowId: `task:${taskId}`,
  status,
  terminalEventId: taskId === 'a' ? 1 : 2,
})

describe('required-success Scheduler dependency gate', () => {
  it('waits, runs, and cancels from required-success terminal facts', () => {
    expect(resolveRequiredSuccessDependencyDecision(['a', 'b'], new Map())).toEqual({
      kind: 'wait',
    })
    expect(
      resolveRequiredSuccessDependencyDecision(
        ['a', 'b'],
        new Map([['a', summary('a', 'completed')]]),
      ),
    ).toEqual({ kind: 'wait' })
    expect(
      resolveRequiredSuccessDependencyDecision(
        ['a', 'b'],
        new Map([
          ['a', summary('a', 'completed')],
          ['b', summary('b', 'completed')],
        ]),
      ),
    ).toEqual({ kind: 'run' })
    expect(
      resolveRequiredSuccessDependencyDecision(
        ['a', 'b'],
        new Map([
          ['a', summary('a', 'completed')],
          ['b', summary('b', 'failed')],
        ]),
      ),
    ).toEqual({ kind: 'cancel', failedTaskIds: ['b'] })
  })

  it('retains a referenced old completion beyond the replay window', () => {
    const completions = Array.from({ length: 2_100 }, (_, index) => ({
      taskId: index === 0 ? 'source-old' : `source-${String(index)}`,
      taskWorkflowId: `task:${String(index)}`,
      status: 'completed' as const,
      terminalEventId: index + 1,
    }))
    const retained = retainSchedulerCompletions({
      queuedDependencyTaskIds: new Set(['source-old']),
      completions,
      replayLimit: 2_048,
    })

    expect(retained.filter((item) => item.taskId === 'source-old')).toHaveLength(1)
  })

  it('deduplicates repeated completion facts by Task ID', () => {
    const retained = retainSchedulerCompletions({
      queuedDependencyTaskIds: new Set(['source-a']),
      completions: [
        { ...summary('source-a', 'completed'), terminalEventId: 1 },
        { ...summary('source-a', 'completed'), terminalEventId: 2 },
        { ...summary('source-b', 'completed'), terminalEventId: 3 },
      ],
      replayLimit: 1,
    })

    expect(retained.filter((item) => item.taskId === 'source-a')).toHaveLength(1)
    expect(retained.find((item) => item.taskId === 'source-a')?.terminalEventId).toBe(2)
  })

  it('validates the complete admission request against persisted dependency topology', () => {
    const fullRequest = request(['source-a', 'source-b'])
    expect(() =>
      validateTaskSchedulerAdmissionDependencies(fullRequest, 'target', [
        'source-a',
        'source-b',
      ]),
    ).not.toThrow()
    expect(() =>
      validateTaskSchedulerAdmissionDependencies(request(['source-a']), 'target', [
        'source-a',
        'source-b',
      ]),
    ).toThrow('TASK_DEPENDENCY_TOPOLOGY_DIVERGED')
  })

  it('rejects scheduler replay when only dependency IDs diverge', () => {
    expect(sameScheduledTask(request(['source-a']), request(['source-b']))).toBe(false)
  })
})
