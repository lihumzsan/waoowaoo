import { describe, expect, it } from 'vitest'
import {
  advanceWorkspaceSseCursor,
  EMPTY_WORKSPACE_SSE_CURSOR,
  isWorkspaceSseEvent,
  parseWorkspaceSseCursor,
  parseWorkspaceSseBootstrap,
  parseWorkspaceSseEventMessage,
  serializeWorkspaceSseCursor,
} from '@/lib/sse/protocol'
import { lifecycleEvent } from './sse-test-fixtures'

describe('workspace SSE protocol parsing', () => {
  it('round-trips and advances independent Task, Assistant, and resource watermarks', () => {
    const taskCursor = advanceWorkspaceSseCursor(EMPTY_WORKSPACE_SSE_CURSOR, lifecycleEvent('12', 10))
    const agentCursor = advanceWorkspaceSseCursor(taskCursor, {
      id: 'agent:9007199254740993',
      type: 'assistant.session.changed',
      projectId: 'project-1',
      userId: 'user-1',
      ts: '2026-04-24T00:00:01.000Z',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      agentEventId: '9007199254740993',
    })
    const resourceCursor = advanceWorkspaceSseCursor(agentCursor, {
      id: 'wr:1777046400001:outbox-2',
      type: 'resource.changed',
      projectId: 'project-1',
      userId: 'user-1',
      ts: '2026-04-24T00:00:01.000Z',
      affectedResources: [{ kind: 'projectData', projectId: 'project-1' }],
    })
    const serialized = serializeWorkspaceSseCursor(resourceCursor)

    expect(serialized).toBe('v4;t=12;a=9007199254740993;r=1777046400001:outbox-2')
    expect(parseWorkspaceSseCursor(serialized)).toEqual(resourceCursor)
    expect(advanceWorkspaceSseCursor(resourceCursor, lifecycleEvent('11', 20))).toEqual(resourceCursor)
  })

  it('rejects old cursor protocols instead of maintaining a replay compatibility track', () => {
    expect(() => parseWorkspaceSseCursor('v1;t=12;m=1777046400000:batch-2'))
      .toThrow('SSE_CURSOR_INVALID')
    expect(() => parseWorkspaceSseCursor('v2;t=12;m=1777046400000:batch-2;a=9'))
      .toThrow('SSE_CURSOR_INVALID')
    expect(() => parseWorkspaceSseCursor('v3;t=12;m=1777046400000:batch-2;a=9;r=0:-'))
      .toThrow('SSE_CURSOR_INVALID')
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
