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

  it('retries a torn read once and returns the stable ProjectAgentEvent watermark', async () => {
    prismaMock.projectAgentEvent.findFirst
      .mockResolvedValueOnce({ id: BigInt(41) })
      .mockResolvedValueOnce({ id: BigInt(42) })
      .mockResolvedValueOnce({ id: BigInt(42) })
      .mockResolvedValueOnce({ id: BigInt(42) })
    const snapshot = await getProjectAgentSessionSnapshot({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      locale: 'zh',
    })
    expect(prismaMock.projectAgentEvent.findFirst).toHaveBeenCalledTimes(4)
    expect(snapshot.eventWatermark).toBe('42')
  })

  it('fails explicitly when concurrent events prevent a consistent snapshot twice', async () => {
    prismaMock.projectAgentEvent.findFirst
      .mockResolvedValueOnce({ id: BigInt(41) })
      .mockResolvedValueOnce({ id: BigInt(42) })
      .mockResolvedValueOnce({ id: BigInt(42) })
      .mockResolvedValueOnce({ id: BigInt(43) })
    await expect(getProjectAgentSessionSnapshot({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      locale: 'zh',
    })).rejects.toThrow('PROJECT_AGENT_SESSION_SNAPSHOT_UNSTABLE')
  })

  it('discards an old Thread GET that overlaps a clear event and returns the stable empty snapshot', async () => {
    prismaMock.projectAgentEvent.findFirst
      .mockResolvedValueOnce({ id: BigInt(41) })
      .mockResolvedValueOnce({ id: BigInt(42) })
      .mockResolvedValueOnce({ id: BigInt(42) })
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
      .mockResolvedValueOnce(null)

    const snapshot = await getProjectAssistantThreadWatermarkedSnapshot({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })

    expect(prismaMock.projectAssistantThread.findUnique).toHaveBeenCalledTimes(2)
    expect(snapshot).toEqual({ thread: null, eventWatermark: '42' })
  })
})
