import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(),
  },
  projectEditChapter: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  projectPanel: {
    findMany: vi.fn(),
  },
  projectVideoGroup: {
    findMany: vi.fn(),
  },
}))

const fsMock = vi.hoisted(() => ({
  mkdtemp: vi.fn(async () => '/tmp/chapter-render-test'),
  readFile: vi.fn(),
  rm: vi.fn(async () => undefined),
}))

const finalRenderMock = vi.hoisted(() => ({
  buildEditScript: vi.fn(),
  concatClips: vi.fn(),
  normalizeClip: vi.fn(),
  probeDurationSeconds: vi.fn(),
  runCommand: vi.fn(),
  writeVideoSourceToFile: vi.fn(),
}))

const mediaServiceMock = vi.hoisted(() => ({
  ensureMediaObjectFromStorageKey: vi.fn(),
  getMediaObjectById: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('node:fs/promises', () => fsMock)
vi.mock('@/lib/media/service', () => mediaServiceMock)
vi.mock('@/lib/storage', () => ({
  generateUniqueKey: vi.fn(() => 'chapter-video/key.mp4'),
  uploadObject: vi.fn(async () => 'chapter-video/key.mp4'),
}))
vi.mock('@/lib/video-compose/final-render-errors', () => ({
  assertFinalRenderClipsHaveSources: vi.fn(),
  normalizeFinalRenderErrorLocale: vi.fn(() => 'en'),
}))
vi.mock('@/lib/video-compose/final-render-plan', () => ({
  buildFinalRenderClips: vi.fn(() => []),
  resolveFinalRenderDimensions: vi.fn(() => ({ width: 1920, height: 1080 })),
}))
vi.mock('@/lib/video-compose/final-render-audio', () => ({
  concatFinalRenderAudioClips: vi.fn(),
  muxFinalRenderSourceAudio: vi.fn(),
  renderFinalRenderClipAudio: vi.fn(),
}))
vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: vi.fn(),
}))
vi.mock('@/lib/workers/final-video-render', () => finalRenderMock)

import { handleChapterRenderTask } from '@/lib/workers/chapter-render'

function buildJob(overrides: Partial<TaskJobData> = {}): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-1',
      type: TASK_TYPE.CHAPTER_RENDER,
      locale: 'en',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'ProjectEpisode',
      targetId: 'episode-1',
      payload: {},
      userId: 'user-1',
      ...overrides,
    },
  } as Job<TaskJobData>
}

function chapterJob(): Job<TaskJobData> {
  return buildJob({
    targetType: 'ProjectEditChapter',
    targetId: 'chapter-1',
    payload: { episodeId: 'episode-1' },
  })
}

describe('handleChapterRenderTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.project.findUnique.mockResolvedValue({ videoRatio: '16:9' })
    prismaMock.projectEditChapter.findFirst.mockResolvedValue({ id: 'chapter-1' })
    prismaMock.projectEditChapter.update.mockResolvedValue({ id: 'chapter-1' })
    prismaMock.projectPanel.findMany.mockResolvedValue([])
    prismaMock.projectVideoGroup.findMany.mockResolvedValue([])
    finalRenderMock.buildEditScript.mockResolvedValue(null)
  })

  it('fails explicitly when neither payload nor task target identifies a chapter', async () => {
    await expect(handleChapterRenderTask(buildJob())).rejects.toThrow('CHAPTER_RENDER_CHAPTER_REQUIRED')
  })

  it('checks chapter ownership before writing processing status', async () => {
    prismaMock.projectEditChapter.findFirst.mockResolvedValueOnce(null)

    await expect(handleChapterRenderTask(chapterJob())).rejects.toThrow('CHAPTER_RENDER_CHAPTER_NOT_FOUND')

    expect(prismaMock.projectEditChapter.update).not.toHaveBeenCalled()
  })

  it('leaves failed target projection to the unified Task terminal service', async () => {
    finalRenderMock.buildEditScript.mockRejectedValueOnce(new Error('original render failure'))

    await expect(handleChapterRenderTask(chapterJob())).rejects.toThrow('original render failure')

    expect(prismaMock.projectEditChapter.update).toHaveBeenCalledTimes(1)
    expect(prismaMock.projectEditChapter.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ renderStatus: 'failed' }),
    }))
  })

  it('replays a persisted chapter output without composing the video again', async () => {
    prismaMock.projectEditChapter.findFirst.mockResolvedValueOnce({
      id: 'chapter-1',
      renderStatus: 'completed',
      renderTaskId: 'task-1',
      outputMediaId: 'media-chapter',
    })
    mediaServiceMock.getMediaObjectById.mockResolvedValueOnce({
      id: 'media-chapter',
      url: '/m/chapter.mp4',
      storageKey: 'video/chapter.mp4',
      durationMs: 3000,
      width: 1920,
      height: 1080,
    })

    const result = await handleChapterRenderTask(chapterJob())

    expect(result).toMatchObject({ mediaId: 'media-chapter', durationSeconds: 3 })
    expect(prismaMock.projectEditChapter.update).not.toHaveBeenCalled()
    expect(finalRenderMock.concatClips).not.toHaveBeenCalled()
  })
})
