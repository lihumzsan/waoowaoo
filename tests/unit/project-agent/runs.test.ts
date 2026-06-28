import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  projectAgentRun: {
    findMany: vi.fn(async () => [] as Array<{ id: string }>),
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: vi.fn(() => ({
    error: vi.fn(),
  })),
}))

import {
  PROJECT_AGENT_STALE_RUNNING_RECONCILE_MS,
  reconcileStaleRunningProjectAgentRunsForScope,
} from '@/lib/project-agent/runs'

describe('project agent runs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.projectAgentRun.findMany.mockResolvedValue([])
    prismaMock.projectAgentRun.updateMany.mockResolvedValue({ count: 0 })
  })

  it('marks stale running runs without pending interactions or waits as failed', async () => {
    const now = new Date('2026-06-28T10:00:00.000Z')
    prismaMock.projectAgentRun.findMany.mockResolvedValueOnce([
      { id: 'run-stale-1' },
      { id: 'run-stale-2' },
    ])

    const reconciledIds = await reconcileStaleRunningProjectAgentRunsForScope({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      now,
    })

    expect(reconciledIds).toEqual(['run-stale-1', 'run-stale-2'])
    expect(prismaMock.projectAgentRun.findMany).toHaveBeenCalledWith({
      where: {
        projectId: 'project-1',
        userId: 'user-1',
        assistantId: 'workspace-command',
        scopeRef: 'episode:episode-1',
        status: 'running',
        updatedAt: {
          lt: new Date(now.getTime() - PROJECT_AGENT_STALE_RUNNING_RECONCILE_MS),
        },
        interruptions: {
          none: {
            status: 'pending',
          },
        },
        waits: {
          none: {
            status: {
              in: ['pending', 'resolved', 'claimed'],
            },
          },
        },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 20,
    })
    expect(prismaMock.projectAgentRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['run-stale-1', 'run-stale-2'] },
        status: 'running',
      },
      data: {
        status: 'failed',
        stopReason: 'stale_running_reconciled',
        errorCode: 'PROJECT_AGENT_STALE_RUNNING_RECONCILED',
        errorMessage: 'Project agent run stayed running without a pending approval, choice, or task wait.',
        failedAt: now,
      },
    })
  })

  it('does not write when no stale running runs match the guarded query', async () => {
    const reconciledIds = await reconcileStaleRunningProjectAgentRunsForScope({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      now: new Date('2026-06-28T10:00:00.000Z'),
    })

    expect(reconciledIds).toEqual([])
    expect(prismaMock.projectAgentRun.updateMany).not.toHaveBeenCalled()
  })
})
