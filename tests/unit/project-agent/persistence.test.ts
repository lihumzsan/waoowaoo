import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  projectAssistantThread: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import {
  appendProjectAssistantThreadMessages,
  buildProjectAssistantScopeRef,
  clearProjectAssistantThread,
  loadProjectAssistantThread,
} from '@/lib/project-agent/persistence'

describe('project assistant persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<unknown>) => (
      await callback(prismaMock)
    ))
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'thread-1' }])
  })

  it('buildProjectAssistantScopeRef -> uses episode scope when episode is present', () => {
    expect(buildProjectAssistantScopeRef({
      projectId: 'project-1',
      episodeId: 'episode-1',
    })).toBe('episode:episode-1')
  })

  it('loadProjectAssistantThread -> returns validated persisted messages', async () => {
    prismaMock.projectAssistantThread.findUnique.mockResolvedValueOnce({
      id: 'thread-1',
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      messagesJson: [
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'persisted' }],
        },
      ],
      createdAt: new Date('2026-04-13T00:00:00.000Z'),
      updatedAt: new Date('2026-04-13T00:00:00.000Z'),
    })

    const thread = await loadProjectAssistantThread({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })

    expect(thread).toEqual({
      id: 'thread-1',
      assistantId: 'workspace-command',
      projectId: 'project-1',
      episodeId: 'episode-1',
      scopeRef: 'episode:episode-1',
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'persisted' }],
        },
      ],
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z',
    })
  })

  it('loadProjectAssistantThread -> repairs duplicate message ids before returning persisted messages', async () => {
    prismaMock.projectAssistantThread.findUnique.mockResolvedValueOnce({
      id: 'thread-1',
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      messagesJson: [
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'first' }],
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'second' }],
        },
      ],
      createdAt: new Date('2026-04-13T00:00:00.000Z'),
      updatedAt: new Date('2026-04-13T00:00:00.000Z'),
    })

    const thread = await loadProjectAssistantThread({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })

    expect(thread?.messages).toEqual([
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'first' }],
      },
      {
        id: 'assistant-1--dedup-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'second' }],
      },
    ])
  })

  it('appendProjectAssistantThreadMessages -> appends new message ids while preserving order', async () => {
    prismaMock.projectAssistantThread.findUnique.mockResolvedValueOnce({
      id: 'thread-1',
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      messagesJson: [
        {
          id: 'user-1',
          role: 'user',
          parts: [{ type: 'text', text: '第一条' }],
        },
      ],
      createdAt: new Date('2026-04-13T00:00:00.000Z'),
      updatedAt: new Date('2026-04-13T00:00:00.000Z'),
    })
    prismaMock.projectAssistantThread.upsert.mockResolvedValueOnce({
      id: 'thread-1',
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      messagesJson: [],
      createdAt: new Date('2026-04-13T00:00:00.000Z'),
      updatedAt: new Date('2026-04-13T00:00:00.000Z'),
    })
    prismaMock.projectAssistantThread.update.mockResolvedValueOnce({
      id: 'thread-1',
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      messagesJson: [],
      createdAt: new Date('2026-04-13T00:00:00.000Z'),
      updatedAt: new Date('2026-04-13T00:00:00.000Z'),
    })

    await appendProjectAssistantThreadMessages({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      messages: [
        {
          id: 'user-1',
          role: 'user',
          parts: [{ type: 'text', text: '重复请求不应追加' }],
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: '第二条' }],
        },
      ],
    })

    expect(prismaMock.projectAssistantThread.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        messagesJson: [
          {
            id: 'user-1',
            role: 'user',
            parts: [{ type: 'text', text: '第一条' }],
          },
          {
            id: 'assistant-1',
            role: 'assistant',
            parts: [{ type: 'text', text: '第二条' }],
          },
        ],
      }),
    }))
  })

  it('appendProjectAssistantThreadMessages -> skips storage write when all appended ids already exist', async () => {
    prismaMock.projectAssistantThread.findUnique.mockResolvedValueOnce({
      id: 'thread-1',
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      messagesJson: [
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: '已保存' }],
        },
      ],
      createdAt: new Date('2026-04-13T00:00:00.000Z'),
      updatedAt: new Date('2026-04-13T00:00:00.000Z'),
    })

    const thread = await appendProjectAssistantThreadMessages({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: '重复响应' }],
        },
      ],
    })

    expect(thread.messages).toEqual([
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: '已保存' }],
      },
    ])
    expect(prismaMock.projectAssistantThread.update).not.toHaveBeenCalled()
  })

  it('loadProjectAssistantThread -> fails explicitly on corrupted stored messages', async () => {
    prismaMock.projectAssistantThread.findUnique.mockResolvedValueOnce({
      id: 'thread-1',
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      messagesJson: { broken: true },
      createdAt: new Date('2026-04-13T00:00:00.000Z'),
      updatedAt: new Date('2026-04-13T00:00:00.000Z'),
    })

    await expect(loadProjectAssistantThread({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })).rejects.toThrow('PROJECT_ASSISTANT_INVALID_THREAD_MESSAGES')
  })

  it('clearProjectAssistantThread -> deletes the scoped thread row', async () => {
    prismaMock.projectAssistantThread.deleteMany.mockResolvedValueOnce({ count: 1 })

    await clearProjectAssistantThread({
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
  })
})
