import { describe, expect, it } from 'vitest'
import type { SSEEvent } from '@/lib/task/types'
import {
  advanceWorkspaceSseCursor,
  EMPTY_WORKSPACE_SSE_CURSOR,
  isWorkspaceSseEvent,
  parseWorkspaceSseCursor,
  parseWorkspaceSseBootstrap,
  parseWorkspaceSseEventMessage,
  serializeWorkspaceSseCursor,
} from '@/lib/sse/protocol'
import {
  SseBootstrapBufferOverflowError,
  SseEventIdentityConflictError,
  WorkspaceSseServerSession,
} from '@/lib/sse/server-session'

function lifecycleEvent(id: string, progress: number): SSEEvent {
  return {
    id,
    type: 'task.lifecycle',
    taskId: 'task-1',
    projectId: 'project-1',
    userId: 'user-1',
    ts: '2026-07-11T00:00:00.000Z',
    payload: {
      lifecycleType: 'task.progress',
      progress,
    },
  }
}

describe('workspace SSE server session', () => {
  it('emits bootstrap before buffered live events and then switches to live mode', () => {
    const emitted: SSEEvent[] = []
    const session = new WorkspaceSseServerSession((event) => emitted.push(event))
    const bootstrap = lifecycleEvent('10', 10)
    const duringBootstrap = lifecycleEvent('11', 20)
    const live = lifecycleEvent('12', 30)

    session.receiveLiveEvent(duringBootstrap)
    session.completeBootstrap([bootstrap])
    session.receiveLiveEvent(live)

    expect(emitted).toEqual([bootstrap, duringBootstrap, live])
  })

  it('deduplicates an identical event across snapshot and buffer', () => {
    const emitted: SSEEvent[] = []
    const session = new WorkspaceSseServerSession((event) => emitted.push(event))
    const snapshot = lifecycleEvent('10', 10)
    const sameIdentity = lifecycleEvent('10', 10)

    session.receiveLiveEvent(sameIdentity)
    session.completeBootstrap([snapshot])

    expect(emitted).toEqual([snapshot])
  })

  it('fails explicitly when the same namespaced event identity carries different facts', () => {
    const session = new WorkspaceSseServerSession(() => undefined)
    session.receiveLiveEvent(lifecycleEvent('10', 20))

    expect(() => session.completeBootstrap([lifecycleEvent('10', 10)]))
      .toThrow(SseEventIdentityConflictError)
  })

  it('fails explicitly when live traffic exceeds the bounded bootstrap buffer', () => {
    const session = new WorkspaceSseServerSession(() => undefined, 1)
    session.receiveLiveEvent(lifecycleEvent('10', 10))

    expect(() => session.receiveLiveEvent(lifecycleEvent('11', 20)))
      .toThrow(SseBootstrapBufferOverflowError)
  })
})

describe('workspace SSE protocol parsing', () => {
  it('round-trips and advances independent Task and mutation watermarks', () => {
    const taskCursor = advanceWorkspaceSseCursor(EMPTY_WORKSPACE_SSE_CURSOR, lifecycleEvent('12', 10))
    const mutationCursor = advanceWorkspaceSseCursor(taskCursor, {
      id: 'mb:1777046400000:batch-2',
      type: 'mutation.batch',
      mutationBatchId: 'batch-2',
      projectId: 'project-1',
      userId: 'user-1',
      ts: '2026-04-24T00:00:00.000Z',
      operationId: null,
      episodeId: 'episode-1',
      targets: [],
    })
    const serialized = serializeWorkspaceSseCursor(mutationCursor)

    expect(serialized).toBe('v1;t=12;m=1777046400000:batch-2')
    expect(parseWorkspaceSseCursor(serialized)).toEqual(mutationCursor)
    expect(advanceWorkspaceSseCursor(mutationCursor, lifecycleEvent('11', 20))).toEqual(mutationCursor)
  })

  it('rejects malformed composite cursors instead of silently resetting replay', () => {
    expect(() => parseWorkspaceSseCursor('v1;t=12;m=broken'))
      .toThrow('SSE_CURSOR_INVALID')
  })

  it('rejects unknown event types and malformed bootstrap events', () => {
    const unknown = {
      ...lifecycleEvent('10', 10),
      type: 'task.unknown',
    }
    expect(isWorkspaceSseEvent(unknown)).toBe(false)
    expect(() => parseWorkspaceSseEventMessage(JSON.stringify(unknown)))
      .toThrow('SSE_MESSAGE_PAYLOAD_INVALID')
    expect(() => parseWorkspaceSseBootstrap({
      channel: 'project:project-1',
      mode: 'recoverable_snapshot',
      events: [unknown],
    })).toThrow('SSE_BOOTSTRAP_EVENTS_INVALID')
  })
})
