import { describe, expect, it, vi } from 'vitest'
import {
  TASK_EVENT_TYPE,
  TASK_SSE_EVENT_TYPE,
} from '@/lib/task/types'
import { WorkspaceSSEEventSequence } from '@/lib/query/workspace-sse-event-sequence'
import { taskEvent } from './workspace-sse-event-sequence.test-fixtures'

describe('WorkspaceSSEEventSequence', () => {
  it('lets independent tabs consume the same Assistant event and rejects replay at the persisted Assistant cursor', () => {
    const event = {
      id: 'agent:21',
      type: 'assistant.session.changed' as const,
      projectId: 'project-1',
      userId: 'user-1',
      ts: '2026-07-11T00:00:00.000Z',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      agentEventId: '21',
    }
    const firstTab = new WorkspaceSSEEventSequence(0, {}, '20')
    const secondTab = new WorkspaceSSEEventSequence(0, {}, '20')
    expect(firstTab.process(event, vi.fn())).toBe('accepted')
    expect(secondTab.process(event, vi.fn())).toBe('accepted')
    expect(firstTab.getLastAgentEventId()).toBe('21')
    expect(new WorkspaceSSEEventSequence(0, {}, '21').process(event, vi.fn()))
      .toBe('rejected_stale')
  })
  it('applies one event id exactly once and rejects an older event for the same Task', () => {
    const sequence = new WorkspaceSSEEventSequence()
    const apply = vi.fn()
    expect(sequence.process(taskEvent({ id: '12', lifecycleType: TASK_EVENT_TYPE.PROCESSING }), apply)).toBe('accepted')
    expect(sequence.process(taskEvent({ id: '12', lifecycleType: TASK_EVENT_TYPE.PROCESSING }), apply)).toBe('duplicate')
    expect(sequence.process(taskEvent({ id: '9', lifecycleType: TASK_EVENT_TYPE.PROCESSING }), apply)).toBe('rejected_stale')
    expect(apply).toHaveBeenCalledTimes(1)
    expect(sequence.getLastNumericEventId()).toBe(12)
  })

  it('requests snapshot resync when the same live identity carries a different fingerprint', () => {
    const sequence = new WorkspaceSSEEventSequence()
    const apply = vi.fn()
    expect(sequence.process(taskEvent({ id: '12', lifecycleType: TASK_EVENT_TYPE.PROCESSING }), apply)).toBe('accepted')

    expect(() => sequence.process(taskEvent({ id: '12', lifecycleType: TASK_EVENT_TYPE.COMPLETED }), apply))
      .toThrow('WORKSPACE_SSE_SNAPSHOT_RESYNC_REQUIRED:event_identity_conflict')
    expect(apply).toHaveBeenCalledTimes(1)
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

  it('treats canceled as terminal and rejects late lifecycle and stream events', () => {
    const sequence = new WorkspaceSSEEventSequence()
    const apply = vi.fn()
    expect(sequence.process(taskEvent({ id: '44', lifecycleType: TASK_EVENT_TYPE.CANCELED }), apply)).toBe('accepted')
    expect(sequence.process(taskEvent({ id: '45', lifecycleType: TASK_EVENT_TYPE.PROCESSING }), apply)).toBe('rejected_after_terminal')
    expect(sequence.process(taskEvent({ id: 'ephemeral:late', type: TASK_SSE_EVENT_TYPE.STREAM }), apply)).toBe('rejected_after_terminal')
    expect(apply).toHaveBeenCalledTimes(1)
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

})
