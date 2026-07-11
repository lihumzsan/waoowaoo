import { beforeEach, describe, expect, it, vi } from 'vitest'

const findUniqueMock = vi.hoisted(() => vi.fn())
const findFirstMock = vi.hoisted(() => vi.fn())
const publishMock = vi.hoisted(() => vi.fn(async () => 1))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    projectAgentEvent: {
      findUnique: findUniqueMock,
      findFirst: findFirstMock,
    },
  },
}))
vi.mock('@/lib/redis', () => ({ redis: { publish: publishMock } }))
vi.mock('@/lib/task/publisher', () => ({
  getProjectChannel: (projectId: string) => `task-events:project:${projectId}`,
}))

import {
  listLatestProjectAgentSessionChangedEvent,
  publishPersistedProjectAgentSessionChangedById,
} from '@/lib/project-agent/session-event'

describe('Project Agent session event publisher', () => {
  beforeEach(() => vi.clearAllMocks())

  it('publishes the persisted ProjectAgentEvent as the sole Assistant SSE envelope', async () => {
    findUniqueMock.mockResolvedValueOnce({
      id: BigInt(42),
      projectId: 'project-1',
      userId: 'user-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      episodeId: 'episode-1',
      createdAt: new Date('2026-07-11T00:00:00.000Z'),
    })
    await publishPersistedProjectAgentSessionChangedById('42')
    expect(publishMock).toHaveBeenCalledWith(
      'task-events:project:project-1',
      JSON.stringify({
        id: 'agent:42',
        type: 'assistant.session.changed',
        projectId: 'project-1',
        userId: 'user-1',
        ts: '2026-07-11T00:00:00.000Z',
        episodeId: 'episode-1',
        assistantId: 'workspace-command',
        scopeRef: 'episode:episode-1',
        agentEventId: '42',
      }),
    )
  })

  it('selects only the newest event after the durable Assistant watermark and exact scope', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: BigInt(44),
      projectId: 'project-1',
      userId: 'user-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      episodeId: 'episode-1',
      createdAt: new Date('2026-07-11T00:00:01.000Z'),
    })
    const events = await listLatestProjectAgentSessionChangedEvent({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      afterEventId: '42',
    })
    expect(findFirstMock).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        projectId: 'project-1',
        userId: 'user-1',
        assistantId: 'workspace-command',
        scopeRef: 'episode:episode-1',
        id: { gt: BigInt(42) },
      },
      orderBy: { id: 'desc' },
    }))
    expect(events).toEqual([expect.objectContaining({ id: 'agent:44', agentEventId: '44' })])
  })
})
