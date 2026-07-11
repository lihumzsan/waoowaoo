import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReplayEvent } from './sse-ops.test-fixtures'
import { buildSseOperationContext } from './sse-ops.test-fixtures'

const listLatestProjectAgentSessionChangedEventMock = vi.hoisted(
  () => vi.fn<() => Promise<ReplayEvent[]>>(async () => []),
)
const taskFindManyMock = vi.hoisted(() => vi.fn(async () => []))

vi.mock('@/lib/task/publisher', () => ({
  getProjectChannel: (projectId: string) => `project:${projectId}`,
  listEventsAfter: vi.fn(async () => []),
  listRecentTerminalLifecycleEvents: vi.fn(async () => []),
}))
vi.mock('@/lib/mutation-batch/service', () => ({
  listMutationBatchReplayEvents: vi.fn(async () => []),
}))
vi.mock('@/lib/project-agent/session-event', () => ({
  listLatestProjectAgentSessionChangedEvent: listLatestProjectAgentSessionChangedEventMock,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findMany: taskFindManyMock,
    },
  },
}))

import { createSseOperations } from '@/lib/operations/domains/debug/sse-ops'

describe('sse bootstrap Assistant replay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    taskFindManyMock.mockResolvedValue([])
    listLatestProjectAgentSessionChangedEventMock.mockResolvedValue([])
  })

  it('replays only the latest level-triggered Assistant event for the requested scope', async () => {
    const assistantEvent = {
      id: 'agent:42',
      type: 'assistant.session.changed',
      projectId: 'project-1',
      userId: 'user-1',
      ts: '2026-04-24T00:00:04.000Z',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      agentEventId: '42',
    }
    listLatestProjectAgentSessionChangedEventMock.mockResolvedValueOnce([assistantEvent])

    const result = await createSseOperations().get_sse_bootstrap.execute!(
      buildSseOperationContext() as never,
      {
        episodeId: 'episode-1',
        lastEventId: 'v2;t=0;m=0:-;a=41',
      } as never,
    )

    expect(listLatestProjectAgentSessionChangedEventMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      afterEventId: '41',
    })
    expect((result as { events: ReplayEvent[] }).events).toContainEqual(assistantEvent)
  })
})
