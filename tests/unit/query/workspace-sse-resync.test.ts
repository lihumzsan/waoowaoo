import { describe, expect, it } from 'vitest'
import { WorkspaceSSESnapshotResyncRequiredError } from '@/lib/query/workspace-sse-event-sequence'
import {
  isWorkspaceSseImmediateResyncError,
  recoverWorkspaceSseEventError,
} from '@/lib/query/workspace-sse-resync'

describe('workspace SSE immediate resync errors', () => {
  it('recognizes every sequence resync reason as an immediate resync request', () => {
    expect(isWorkspaceSseImmediateResyncError(
      new WorkspaceSSESnapshotResyncRequiredError('event_identity_window_overflow'),
    )).toBe(true)
    expect(isWorkspaceSseImmediateResyncError(
      new WorkspaceSSESnapshotResyncRequiredError('event_identity_conflict'),
    )).toBe(true)
    expect(isWorkspaceSseImmediateResyncError(
      new WorkspaceSSESnapshotResyncRequiredError('task_watermark_window_overflow'),
    )).toBe(true)
    expect(isWorkspaceSseImmediateResyncError(
      new Error('WORKSPACE_SSE_EVENT_INVALID'),
    )).toBe(false)
  })

  it('rotates the connection instead of backing off for a saturated event sequence', () => {
    const calls: string[] = []

    const decision = recoverWorkspaceSseEventError({
      error: new WorkspaceSSESnapshotResyncRequiredError('event_identity_window_overflow'),
      requestSnapshotResync: () => calls.push('snapshot'),
      scheduleResync: (context) => calls.push(`backoff:${context}`),
    })

    expect(decision).toBe('immediate_snapshot')
    expect(calls).toEqual(['snapshot'])
  })

  it('keeps malformed events on bounded backoff', () => {
    const calls: string[] = []

    const decision = recoverWorkspaceSseEventError({
      error: new Error('WORKSPACE_SSE_EVENT_INVALID'),
      requestSnapshotResync: () => calls.push('snapshot'),
      scheduleResync: (context) => calls.push(`backoff:${context}`),
    })

    expect(decision).toBe('backoff')
    expect(calls).toEqual(['backoff:event handling failed'])
  })
})
