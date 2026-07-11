import { beforeEach, describe, expect, it, vi } from 'vitest'

const reduceProjectAgentEventMock = vi.hoisted(() => vi.fn(async () => null))
const createOutboxCommandInTransactionMock = vi.hoisted(() => vi.fn(async () => ({ id: 'outbox-1' })))

vi.mock('@/lib/project-agent/event/reducer', () => ({
  reduceProjectAgentEvent: reduceProjectAgentEventMock,
}))
vi.mock('@/lib/outbox/repository', () => ({
  createOutboxCommandInTransaction: createOutboxCommandInTransactionMock,
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  appendProjectAgentEventsInTransaction,
  appendProjectAgentSessionEventInTransaction,
} from '@/lib/project-agent/event/append'

describe('appendProjectAgentEventsInTransaction Assistant broadcast', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates the durable Assistant broadcast in the same transaction as a new event', async () => {
    const tx = {
      projectAgentEvent: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: BigInt(42) })),
      },
    }
    const fence = { runId: 'run-1', runVersion: 0, eventSeq: '0' }
    await appendProjectAgentEventsInTransaction(tx as never, {
      scope: {
        projectId: 'project-1',
        userId: 'user-1',
        episodeId: 'episode-1',
        assistantId: 'workspace-command',
        scopeRef: 'episode:episode-1',
      },
      events: [{
        event: {
          kind: 'run.started',
          runId: 'run-1',
          requestId: 'request-1',
          controlKind: 'user_turn',
        },
        runFence: fence,
        idempotencyKey: 'run-started:run-1',
      }],
    })
    expect(createOutboxCommandInTransactionMock).toHaveBeenCalledWith(tx, {
      idempotencyKey: 'project-agent-session-broadcast:42',
      aggregateType: 'project_agent_event',
      aggregateId: '42',
      payload: {
        kind: 'project_agent.session_broadcast',
        version: 1,
        projectAgentEventId: '42',
      },
    })
    expect(fence).toEqual({ runId: 'run-1', runVersion: 1, eventSeq: '42' })
  })

  it('repairs a missing broadcast idempotently when the ProjectAgentEvent already exists', async () => {
    const tx = {
      projectAgentEvent: {
        findUnique: vi.fn(async () => ({
          id: BigInt(42),
          payload: { expectedRunVersion: 0, expectedEventSeq: '0' },
        })),
        create: vi.fn(),
      },
    }
    await appendProjectAgentEventsInTransaction(tx as never, {
      scope: {
        projectId: 'project-1',
        userId: 'user-1',
        episodeId: null,
        assistantId: 'workspace-command',
        scopeRef: 'project:project-1',
      },
      events: [{
        event: {
          kind: 'run.started',
          runId: 'run-1',
          requestId: 'request-1',
          controlKind: 'user_turn',
        },
        runFence: { runId: 'run-1', runVersion: 0, eventSeq: '0' },
        idempotencyKey: 'run-started:run-1',
      }],
    })
    expect(tx.projectAgentEvent.create).not.toHaveBeenCalled()
    expect(createOutboxCommandInTransactionMock).toHaveBeenCalledTimes(1)
  })

  it('persists a scope-level thread clear and its broadcast without a fabricated Run or reducer transition', async () => {
    const tx = {
      projectAgentEvent: {
        create: vi.fn(async () => ({ id: BigInt(43) })),
      },
    }
    const eventWatermark = await appendProjectAgentSessionEventInTransaction(tx as never, {
      scope: {
        projectId: 'project-1',
        userId: 'user-1',
        episodeId: 'episode-1',
        assistantId: 'workspace-command',
      },
      event: { kind: 'thread.cleared' },
    })
    expect(tx.projectAgentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        runId: null,
        activityId: null,
        kind: 'thread.cleared',
        payload: { kind: 'thread.cleared' },
      }),
      select: { id: true },
    })
    expect(reduceProjectAgentEventMock).not.toHaveBeenCalled()
    expect(createOutboxCommandInTransactionMock).toHaveBeenCalledWith(tx, expect.objectContaining({
      idempotencyKey: 'project-agent-session-broadcast:43',
      aggregateId: '43',
    }))
    expect(eventWatermark).toBe('43')
  })
})
