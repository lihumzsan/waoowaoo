import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findFirst: vi.fn(),
  },
}))

const submitTaskMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))

async function loadSubmitter() {
  return await import('@/lib/novel-promotion/episode-cover/task')
}

describe('Episode cover task submission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    submitTaskMock.mockResolvedValue({
      success: true,
      async: true,
      taskId: 'task-cover-1',
      status: 'queued',
      deduped: false,
    })
  })

  it('skips automatic submission when the Episode already has a cover', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      id: 'episode-1',
      coverImageMediaId: 'media-cover-existing',
    })
    const { submitEpisodeCoverTask } = await loadSubmitter()

    const result = await submitEpisodeCoverTask({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      mode: 'auto',
    })

    expect(result).toEqual({
      success: true,
      async: false,
      skipped: true,
      reason: 'cover_exists',
      coverImageMediaId: 'media-cover-existing',
    })
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('submits manual regeneration with a stable active-task dedupe key', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      id: 'episode-1',
      coverImageMediaId: 'media-cover-existing',
    })
    const { submitEpisodeCoverTask } = await loadSubmitter()

    const result = await submitEpisodeCoverTask({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      episodeId: 'episode-1',
      mode: 'manual',
      requestId: 'request-1',
    })

    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'episode-1',
        novelPromotionProject: { projectId: 'project-1' },
      },
      select: {
        id: true,
        coverImageMediaId: true,
      },
    })
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      locale: 'en',
      requestId: 'request-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      type: 'image_episode_cover',
      targetType: 'NovelPromotionEpisode',
      targetId: 'episode-1',
      maxAttempts: 2,
      dedupeKey: 'image_episode_cover:episode-1',
      payload: expect.objectContaining({
        episodeId: 'episode-1',
        trigger: 'manual',
      }),
    }))
    expect(result).toEqual(expect.objectContaining({ taskId: 'task-cover-1' }))
  })
})
