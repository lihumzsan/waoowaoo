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

    expect(serialized).toBe('v2;t=12;m=1777046400000:batch-2;a=0')
    expect(parseWorkspaceSseCursor(serialized)).toEqual(mutationCursor)
    expect(advanceWorkspaceSseCursor(mutationCursor, lifecycleEvent('11', 20))).toEqual(mutationCursor)
  })

  it('upgrades legacy v1 cursors and advances the independent Assistant watermark', () => {
    const legacy = parseWorkspaceSseCursor('v1;t=12;m=1777046400000:batch-2')
    expect(legacy.agentEventId).toBe('0')
    const advanced = advanceWorkspaceSseCursor(legacy, {
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
    expect(serializeWorkspaceSseCursor(advanced))
      .toBe('v2;t=12;m=1777046400000:batch-2;a=9007199254740993')
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
