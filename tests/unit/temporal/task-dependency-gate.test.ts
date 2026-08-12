import { describe, expect, it } from 'vitest'
import {
  resolveRequiredSuccessDependencyDecision,
  retainSchedulerCompletions,
  type SchedulerDependencyCompletion,
} from '@/lib/temporal/task/dependency-gate'

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
})
