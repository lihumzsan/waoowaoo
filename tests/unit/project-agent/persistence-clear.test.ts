import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  projectAssistantThread: {
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
  projectAgentRun: {
    findFirst: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
const appendProjectAgentSessionEventInTransactionMock = vi.hoisted(() => vi.fn(async () => '42'))
vi.mock('@/lib/project-agent/event', () => ({
  appendProjectAgentSessionEventInTransaction: appendProjectAgentSessionEventInTransactionMock,
}))

import { clearProjectAssistantThread } from '@/lib/project-agent/thread-clear'

describe('project assistant persistence clearing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<unknown>) => (
      await callback(prismaMock)
    ))
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'thread-1' }])
    prismaMock.projectAgentRun.findFirst.mockResolvedValue(null)
    appendProjectAgentSessionEventInTransactionMock.mockResolvedValue('42')
  })

  it('clearProjectAssistantThread -> locks the scope and deletes only when no Run is active', async () => {
    prismaMock.projectAssistantThread.deleteMany.mockResolvedValueOnce({ count: 1 })

    const result = await clearProjectAssistantThread({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })

    expect(prismaMock.projectAssistantThread.deleteMany).toHaveBeenCalledWith({
      where: {
        projectId: 'project-1',
        userId: 'user-1',
        assistantId: 'workspace-command',
        scopeRef: 'episode:episode-1',
      },
    })
    expect(prismaMock.projectAgentRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        scopeRef: 'episode:episode-1',
        status: { in: ['running', 'awaiting_approval', 'awaiting_choice', 'awaiting_task'] },
      }),
    }))
    expect(appendProjectAgentSessionEventInTransactionMock).toHaveBeenCalledWith(prismaMock, {
      scope: {
        projectId: 'project-1',
        userId: 'user-1',
        episodeId: 'episode-1',
        assistantId: 'workspace-command',
      },
      event: { kind: 'thread.cleared' },
    })
    expect(result).toEqual({ eventWatermark: '42' })
  })

  it('clearProjectAssistantThread -> rejects an active Run without deleting the Thread', async () => {
    prismaMock.projectAgentRun.findFirst.mockResolvedValueOnce({ id: 'run-active' })

    await expect(clearProjectAssistantThread({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })).rejects.toThrow('PROJECT_AGENT_THREAD_ACTIVE:run-active')
    expect(prismaMock.projectAssistantThread.deleteMany).not.toHaveBeenCalled()
    expect(appendProjectAgentSessionEventInTransactionMock).not.toHaveBeenCalled()
  })
})
