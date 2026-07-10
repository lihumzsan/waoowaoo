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
  readonly taskId?: string
  readonly lifecycleType?: TaskLifecycleEventType
  readonly type?: typeof TASK_SSE_EVENT_TYPE[keyof typeof TASK_SSE_EVENT_TYPE]
}): TaskSSEEvent {
  return {
    id: input.id,
    type: input.type ?? TASK_SSE_EVENT_TYPE.LIFECYCLE,
    taskId: input.taskId ?? 'task-1',
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

  it('treats failed as terminal while accepting stream and empty lifecycle payloads beforehand', () => {
    const sequence = new WorkspaceSSEEventSequence()
    const apply = vi.fn()
    const streamWithMisleadingPayload = taskEvent({ id: '40', type: TASK_SSE_EVENT_TYPE.STREAM })
    streamWithMisleadingPayload.payload = { lifecycleType: TASK_EVENT_TYPE.COMPLETED }
    expect(sequence.process(streamWithMisleadingPayload, apply)).toBe('accepted')
    expect(sequence.process(taskEvent({ id: '41' }), apply)).toBe('accepted')
    expect(sequence.process(taskEvent({ id: '42', lifecycleType: TASK_EVENT_TYPE.FAILED }), apply)).toBe('accepted')
    expect(sequence.process(taskEvent({ id: '43', lifecycleType: TASK_EVENT_TYPE.PROCESSING }), apply)).toBe('rejected_after_terminal')
    expect(apply).toHaveBeenCalledTimes(3)
  })

  it('does not classify a non-task workspace event by an extra taskId field', () => {
    const sequence = new WorkspaceSSEEventSequence()
    const apply = vi.fn()
    expect(sequence.process(taskEvent({ id: '50', lifecycleType: TASK_EVENT_TYPE.COMPLETED }), apply)).toBe('accepted')
    expect(sequence.process({
      id: 'resource:50',
      type: 'resource.changed',
      taskId: 'task-1',
      projectId: 'project-1',
      userId: 'user-1',
      ts: '2026-07-11T00:00:01.000Z',
      affectedResources: [],
    }, apply)).toBe('accepted')
    expect(apply).toHaveBeenCalledTimes(2)
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

  it('bounds processed event identities and accepts an identity again after deterministic eviction', () => {
    const sequence = new WorkspaceSSEEventSequence()
    const apply = vi.fn()
    for (let id = 1; id <= 2048; id += 1) {
      expect(sequence.process(taskEvent({
        id: String(id),
        lifecycleType: TASK_EVENT_TYPE.PROCESSING,
      }), apply)).toBe('accepted')
    }

    expect(sequence.process(taskEvent({
      id: '1',
      lifecycleType: TASK_EVENT_TYPE.PROCESSING,
    }), apply)).toBe('duplicate')
    expect(sequence.process(taskEvent({
      id: '2049',
      lifecycleType: TASK_EVENT_TYPE.PROCESSING,
    }), apply)).toBe('accepted')
    expect(sequence.process(taskEvent({
      id: '1',
      lifecycleType: TASK_EVENT_TYPE.PROCESSING,
    }), apply)).toBe('accepted')
    expect(apply).toHaveBeenCalledTimes(2050)
  })

  it('bounds terminal task watermarks so an evicted task identity cannot poison future work forever', () => {
    const sequence = new WorkspaceSSEEventSequence()
    const apply = vi.fn()
    for (let id = 1; id <= 2049; id += 1) {
      expect(sequence.process(taskEvent({
        id: `terminal-${id}`,
        taskId: `task-${id}`,
        lifecycleType: TASK_EVENT_TYPE.COMPLETED,
      }), apply)).toBe('accepted')
    }

    expect(sequence.process(taskEvent({
      id: 'new-attempt-for-evicted-task',
      taskId: 'task-1',
      lifecycleType: TASK_EVENT_TYPE.PROCESSING,
    }), apply)).toBe('accepted')
    expect(apply).toHaveBeenCalledTimes(2050)
  })
})
