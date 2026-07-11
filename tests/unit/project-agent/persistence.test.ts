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
  projectAgentRun: {
    findFirst: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import {
  appendProjectAssistantThreadMessages,
  buildProjectAssistantScopeRef,
  loadProjectAssistantThread,
} from '@/lib/project-agent/persistence'

describe('project assistant persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<unknown>) => (
      await callback(prismaMock)
    ))
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'thread-1' }])
    prismaMock.projectAgentRun.findFirst.mockResolvedValue(null)
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

  it('loadProjectAssistantThread -> fails explicitly on duplicate persisted message ids', async () => {
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

    await expect(loadProjectAssistantThread({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })).rejects.toThrow('PROJECT_ASSISTANT_DUPLICATE_MESSAGE_ID:assistant-1')
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
          parts: [{ type: 'text', text: '第一条' }],
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

  it('appendProjectAssistantThreadMessages -> accepts the empty aggregate row created before locking', async () => {
    const emptyRecord = {
      id: 'thread-1',
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: null,
      assistantId: 'workspace-command',
      scopeRef: 'project:project-1',
      messagesJson: [],
      createdAt: new Date('2026-04-13T00:00:00.000Z'),
      updatedAt: new Date('2026-04-13T00:00:00.000Z'),
    }
    prismaMock.projectAssistantThread.findUnique.mockResolvedValueOnce(emptyRecord)
    prismaMock.projectAssistantThread.upsert.mockResolvedValueOnce(emptyRecord)
    prismaMock.projectAssistantThread.update.mockImplementationOnce(async ({ data }) => ({
      ...emptyRecord,
      messagesJson: data.messagesJson,
    }))

    const message = {
      id: 'assistant-first',
      role: 'assistant' as const,
      parts: [{ type: 'text' as const, text: 'first durable message' }],
    }
    const thread = await appendProjectAssistantThreadMessages({
      projectId: 'project-1',
      userId: 'user-1',
      assistantId: 'workspace-command',
      messages: [message],
    })

    expect(thread.messages).toEqual([message])
    expect(prismaMock.projectAssistantThread.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ messagesJson: [message] }),
    }))
  })

  it('appendProjectAssistantThreadMessages -> skips storage write when the same message id and payload already exist', async () => {
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
          parts: [{ type: 'text', text: '已保存' }],
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

  it('appendProjectAssistantThreadMessages -> rejects the same message id with a different payload', async () => {
    prismaMock.projectAssistantThread.findUnique.mockResolvedValueOnce({
      id: 'thread-1',
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      messagesJson: [{
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: '已保存' }],
      }],
      createdAt: new Date('2026-04-13T00:00:00.000Z'),
      updatedAt: new Date('2026-04-13T00:00:00.000Z'),
    })

    await expect(appendProjectAssistantThreadMessages({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      messages: [{
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: '同一 ID 的冲突内容' }],
      }],
    })).rejects.toThrow('PROJECT_ASSISTANT_MESSAGE_ID_CONFLICT:assistant-1')

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

})
