import {
  beforeEach,
  describe,
  expect,
  getProjectAgentSessionSnapshot,
  getProjectAssistantThreadWatermarkedSnapshot,
  it,
  prismaMock,
  vi,
} from './session-state.fixture'

describe('Project Agent Session snapshot watermark', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the conservative starting watermark when events race a Session read', async () => {
    prismaMock.projectAgentEvent.findFirst
      .mockResolvedValueOnce({ id: BigInt(41) })
      .mockResolvedValueOnce({ id: BigInt(42) })
    const snapshot = await getProjectAgentSessionSnapshot({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      locale: 'zh',
    })
    expect(prismaMock.projectAgentEvent.findFirst).toHaveBeenCalledTimes(2)
    expect(snapshot.eventWatermark).toBe('41')
  })

  it('returns a stable Session watermark when no event races the read', async () => {
    prismaMock.projectAgentEvent.findFirst
      .mockResolvedValueOnce({ id: BigInt(42) })
      .mockResolvedValueOnce({ id: BigInt(42) })
    const snapshot = await getProjectAgentSessionSnapshot({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      locale: 'zh',
    })
    expect(snapshot.eventWatermark).toBe('42')
  })

  it('returns an overlapping Thread read with the conservative watermark for replay convergence', async () => {
    prismaMock.projectAgentEvent.findFirst
      .mockResolvedValueOnce({ id: BigInt(41) })
      .mockResolvedValueOnce({ id: BigInt(42) })
    prismaMock.projectAssistantThread.findUnique
      .mockResolvedValueOnce({
        id: 'thread-old',
        assistantId: 'workspace-command',
        projectId: 'project-1',
        userId: 'user-1',
        episodeId: 'episode-1',
        scopeRef: 'episode:episode-1',
        messagesJson: [{ id: 'old', role: 'user', parts: [{ type: 'text', text: 'old' }] }],
        createdAt: new Date('2026-07-11T00:00:00.000Z'),
        updatedAt: new Date('2026-07-11T00:00:00.000Z'),
      })

    const snapshot = await getProjectAssistantThreadWatermarkedSnapshot({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })

    expect(prismaMock.projectAssistantThread.findUnique).toHaveBeenCalledTimes(1)
    expect(snapshot).toEqual({
      thread: expect.objectContaining({ id: 'thread-old' }),
      eventWatermark: '41',
    })
  })
})
