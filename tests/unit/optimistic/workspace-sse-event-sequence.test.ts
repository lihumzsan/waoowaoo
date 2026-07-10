import { describe, expect, it, vi } from 'vitest'
import {
  TASK_EVENT_TYPE,
  TASK_SSE_EVENT_TYPE,
  type TaskLifecycleEventType,
  type TaskSSEEvent,
} from '@/lib/task/types'
import { WorkspaceSSEEventSequence } from '@/lib/query/workspace-sse-event-sequence'

function taskEvent(input: {
  readonly id: string
  readonly lifecycleType?: TaskLifecycleEventType
  readonly type?: typeof TASK_SSE_EVENT_TYPE[keyof typeof TASK_SSE_EVENT_TYPE]
}): TaskSSEEvent {
  return {
    id: input.id,
    type: input.type ?? TASK_SSE_EVENT_TYPE.LIFECYCLE,
    taskId: 'task-1',
    projectId: 'project-1',
    userId: 'user-1',
    ts: '2026-07-11T00:00:00.000Z',
    payload: input.lifecycleType ? { lifecycleType: input.lifecycleType } : null,
  }
}

describe('WorkspaceSSEEventSequence', () => {
  it('applies one event id exactly once and keeps the maximum numeric replay cursor', () => {
    const sequence = new WorkspaceSSEEventSequence()
    const apply = vi.fn()
    expect(sequence.process(taskEvent({ id: '12', lifecycleType: TASK_EVENT_TYPE.PROCESSING }), apply)).toBe('accepted')
    expect(sequence.process(taskEvent({ id: '12', lifecycleType: TASK_EVENT_TYPE.PROCESSING }), apply)).toBe('duplicate')
    expect(sequence.process(taskEvent({ id: '9', lifecycleType: TASK_EVENT_TYPE.PROCESSING }), apply)).toBe('accepted')
    expect(apply).toHaveBeenCalledTimes(2)
    expect(sequence.getLastNumericEventId()).toBe(12)
  })

  it('rejects lifecycle, stream, and replay events for the same task after terminal', () => {
    const sequence = new WorkspaceSSEEventSequence()
    const apply = vi.fn()
    expect(sequence.process(taskEvent({ id: '20', lifecycleType: TASK_EVENT_TYPE.COMPLETED }), apply)).toBe('accepted')
    expect(sequence.process(taskEvent({ id: '21', lifecycleType: TASK_EVENT_TYPE.PROCESSING }), apply)).toBe('rejected_after_terminal')
    expect(sequence.process(taskEvent({ id: '22', type: TASK_SSE_EVENT_TYPE.STREAM }), apply)).toBe('rejected_after_terminal')
    expect(sequence.process(taskEvent({ id: 'replay:20', lifecycleType: TASK_EVENT_TYPE.COMPLETED }), apply)).toBe('rejected_after_terminal')
    expect(apply).toHaveBeenCalledTimes(1)
    expect(sequence.getLastNumericEventId()).toBe(22)
  })

  it('does not let malformed values mutate execution state', () => {
    const sequence = new WorkspaceSSEEventSequence()
    const apply = vi.fn()
    expect(sequence.process({ id: '30' }, apply)).toBe('invalid')
    expect(sequence.getLastNumericEventId()).toBe(0)
    expect(apply).not.toHaveBeenCalled()
  })

  it('does not record an event when its downstream application fails', () => {
    const sequence = new WorkspaceSSEEventSequence()
    const event = taskEvent({ id: '31', lifecycleType: TASK_EVENT_TYPE.PROCESSING })
    expect(() => sequence.process(event, () => {
      throw new Error('CACHE_WRITE_FAILED')
    })).toThrow('CACHE_WRITE_FAILED')
    expect(sequence.getLastNumericEventId()).toBe(0)
    expect(sequence.process(event, vi.fn())).toBe('accepted')
  })
})
