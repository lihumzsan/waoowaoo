import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  projectAgentRun: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
}))

const eventMock = vi.hoisted(() => ({
  appendProjectAgentEvents: vi.fn(async () => null),
}))

const runLockMock = vi.hoisted(() => ({
  isProjectAgentRunLockActive: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/project-agent/run-lock', () => runLockMock)
vi.mock('@/lib/project-agent/event', () => eventMock)

import {
  cancelRunningProjectAgentRun,
  cancelUnlockedRunningProjectAgentRunsForScope,
} from '@/lib/project-agent/runs'

describe('project agent runs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.projectAgentRun.findFirst.mockResolvedValue(null)
    prismaMock.projectAgentRun.findUnique.mockResolvedValue({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })
    prismaMock.projectAgentRun.findMany.mockResolvedValue([])
    prismaMock.projectAgentRun.updateMany.mockResolvedValue({ count: 0 })
    eventMock.appendProjectAgentEvents.mockResolvedValue(null)
    runLockMock.isProjectAgentRunLockActive.mockResolvedValue(false)
  })

  it('cancels only a currently running run when a response stream is cancelled', async () => {
    prismaMock.projectAgentRun.findFirst.mockResolvedValueOnce({
      id: 'run-1',
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })

    const cancelled = await cancelRunningProjectAgentRun({
      runId: 'run-1',
      stopReason: 'stream_cancelled',
    })

    expect(cancelled).toBe(true)
    expect(eventMock.appendProjectAgentEvents).toHaveBeenCalledWith(expect.objectContaining({
      scope: expect.objectContaining({
        projectId: 'project-1',
        userId: 'user-1',
        episodeId: 'episode-1',
        assistantId: 'workspace-command',
      }),
      events: [expect.objectContaining({
        event: expect.objectContaining({
          kind: 'run.cancelled',
          runId: 'run-1',
          reason: 'stream_cancelled',
        }),
      })],
    }))
  })

  it('does not cancel running runs while the scope still owns a runtime lock', async () => {
    prismaMock.projectAgentRun.findMany.mockResolvedValueOnce([{ id: 'run-1' }])
    runLockMock.isProjectAgentRunLockActive.mockResolvedValueOnce(true)

    const cancelledIds = await cancelUnlockedRunningProjectAgentRunsForScope({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })

    expect(cancelledIds).toEqual([])
    expect(eventMock.appendProjectAgentEvents).not.toHaveBeenCalled()
  })

  it('cancels orphan running runs when the scope has no runtime lock', async () => {
    prismaMock.projectAgentRun.findMany.mockResolvedValueOnce([{ id: 'run-1' }, { id: 'run-2' }])
    runLockMock.isProjectAgentRunLockActive.mockResolvedValueOnce(false)

    const cancelledIds = await cancelUnlockedRunningProjectAgentRunsForScope({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })

    expect(cancelledIds).toEqual(['run-1', 'run-2'])
    expect(eventMock.appendProjectAgentEvents).toHaveBeenCalledTimes(2)
    expect(eventMock.appendProjectAgentEvents).toHaveBeenCalledWith(expect.objectContaining({
      events: [expect.objectContaining({
        event: expect.objectContaining({
          kind: 'run.status_changed',
          runId: 'run-1',
          status: 'cancelled',
          stopReason: 'orphaned_running_run',
        }),
      })],
    }))
  })
})
