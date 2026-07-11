import { describe, expect, it, vi } from 'vitest'
import { TASK_EVENT_TYPE } from '@/lib/task/types'
import {
  WorkspaceSSEEventSequence,
  WorkspaceSSESnapshotResyncRequiredError,
} from '@/lib/query/workspace-sse-event-sequence'
import { taskEvent } from './workspace-sse-event-sequence.test-fixtures'

describe('WorkspaceSSEEventSequence bounded state and persisted cursor', () => {
  it('requests an explicit snapshot resync instead of evicting processed identities', () => {
    const sequence = new WorkspaceSSEEventSequence(0, { eventIdentities: 2, taskWatermarks: 3 })
    const apply = vi.fn()
    expect(sequence.process(taskEvent({ id: '1', taskId: 'task-1', lifecycleType: TASK_EVENT_TYPE.PROCESSING }), apply)).toBe('accepted')
    expect(sequence.process(taskEvent({ id: '2', taskId: 'task-2', lifecycleType: TASK_EVENT_TYPE.PROCESSING }), apply)).toBe('accepted')
    expect(() => sequence.process(taskEvent({ id: '3', taskId: 'task-3', lifecycleType: TASK_EVENT_TYPE.PROCESSING }), apply))
      .toThrow(WorkspaceSSESnapshotResyncRequiredError)
  })

  it('requests an explicit snapshot resync instead of evicting terminal Task watermarks', () => {
    const sequence = new WorkspaceSSEEventSequence(0, { eventIdentities: 3, taskWatermarks: 2 })
    const apply = vi.fn()
    expect(sequence.process(taskEvent({ id: '1', taskId: 'task-1', lifecycleType: TASK_EVENT_TYPE.COMPLETED }), apply)).toBe('accepted')
    expect(sequence.process(taskEvent({ id: '2', taskId: 'task-2', lifecycleType: TASK_EVENT_TYPE.COMPLETED }), apply)).toBe('accepted')
    expect(() => sequence.process(taskEvent({ id: '3', taskId: 'task-3', lifecycleType: TASK_EVENT_TYPE.COMPLETED }), apply))
      .toThrow(WorkspaceSSESnapshotResyncRequiredError)
  })

  it('rejects persisted Task events at or below the connection cursor even when the Task was not seen in this connection', () => {
    const sequence = new WorkspaceSSEEventSequence(12)
    const apply = vi.fn()
    expect(sequence.process(taskEvent({ id: '11', taskId: 'task-old', lifecycleType: TASK_EVENT_TYPE.PROCESSING }), apply))
      .toBe('rejected_stale')
    expect(apply).not.toHaveBeenCalled()
    expect(sequence.getLastNumericEventId()).toBe(12)
  })

  it('accepts a gap replay for another Task after a newer live event advanced the connection cursor', () => {
    const sequence = new WorkspaceSSEEventSequence(0)
    const apply = vi.fn()
    expect(sequence.process(taskEvent({ id: '12', taskId: 'task-live', lifecycleType: TASK_EVENT_TYPE.PROCESSING }), apply))
      .toBe('accepted')
    expect(sequence.process(taskEvent({ id: '11', taskId: 'task-gap', lifecycleType: TASK_EVENT_TYPE.COMPLETED }), apply))
      .toBe('accepted')
    expect(apply).toHaveBeenCalledTimes(2)
    expect(sequence.getLastNumericEventId()).toBe(12)
  })
})
