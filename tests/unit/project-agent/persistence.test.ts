import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  projectAssistantThread: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import {
  buildProjectAssistantScopeRef,
  clearProjectAssistantThread,
  loadProjectAssistantThread,
  saveProjectAssistantThread,
} from '@/lib/project-agent/persistence'

describe('project assistant persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('saveProjectAssistantThread -> upserts the latest timeline with concrete unique scope', async () => {
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

    await saveProjectAssistantThread({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      messages: [
        {
          id: 'user-1',
          role: 'user',
          parts: [{ type: 'text', text: '检查当前进度' }],
        },
      ],
    })

    expect(prismaMock.projectAssistantThread.upsert).toHaveBeenCalledWith({
      where: {
        projectId_userId_assistantId_scopeRef: {
          projectId: 'project-1',
          userId: 'user-1',
          assistantId: 'workspace-command',
          scopeRef: 'episode:episode-1',
        },
      },
      update: {
        episodeId: 'episode-1',
        messagesJson: [
          {
            id: 'user-1',
            role: 'user',
            parts: [{ type: 'text', text: '检查当前进度' }],
          },
        ],
      },
      create: {
        projectId: 'project-1',
        userId: 'user-1',
        episodeId: 'episode-1',
        assistantId: 'workspace-command',
        scopeRef: 'episode:episode-1',
        messagesJson: [
          {
            id: 'user-1',
            role: 'user',
            parts: [{ type: 'text', text: '检查当前进度' }],
          },
        ],
      },
    })
  })

  it('saveProjectAssistantThread -> persists repaired duplicate message ids', async () => {
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

    await saveProjectAssistantThread({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      messages: [
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
    })

    expect(prismaMock.projectAssistantThread.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        messagesJson: [
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
        ],
      }),
    }))
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
