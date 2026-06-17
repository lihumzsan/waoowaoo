import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  projectAgentRun: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
}))

const runLockMock = vi.hoisted(() => ({
  isProjectAgentRunLockActive: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/project-agent/run-lock', () => runLockMock)

import {
  cancelRunningProjectAgentRun,
  cancelUnlockedRunningProjectAgentRunsForScope,
} from '@/lib/project-agent/runs'

describe('project agent runs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.projectAgentRun.findMany.mockResolvedValue([])
    prismaMock.projectAgentRun.updateMany.mockResolvedValue({ count: 0 })
    runLockMock.isProjectAgentRunLockActive.mockResolvedValue(false)
  })

  it('cancels only a currently running run when a response stream is cancelled', async () => {
    prismaMock.projectAgentRun.updateMany.mockResolvedValueOnce({ count: 1 })

    const cancelled = await cancelRunningProjectAgentRun({
      runId: 'run-1',
      stopReason: 'stream_cancelled',
    })

    expect(cancelled).toBe(true)
    expect(prismaMock.projectAgentRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'run-1',
        status: 'running',
      },
      data: expect.objectContaining({
        status: 'cancelled',
        stopReason: 'stream_cancelled',
        errorCode: null,
        errorMessage: null,
        cancelledAt: expect.any(Date) as Date,
      }),
    })
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
    expect(prismaMock.projectAgentRun.updateMany).not.toHaveBeenCalled()
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
    expect(prismaMock.projectAgentRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['run-1', 'run-2'] },
        status: 'running',
      },
      data: expect.objectContaining({
        status: 'cancelled',
        stopReason: 'orphaned_running_run',
        cancelledAt: expect.any(Date) as Date,
      }),
    })
  })
})
