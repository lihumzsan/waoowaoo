import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  task: {
    findUnique: vi.fn(),
  },
}))

const taskServiceMock = vi.hoisted(() => ({
  isTaskActive: vi.fn(async () => true),
  trySetTaskExternalId: vi.fn(async () => true),
}))

const asyncPollMock = vi.hoisted(() => ({
  pollAsyncTask: vi.fn(),
}))

const generatorApiMock = vi.hoisted(() => ({
  generateImage: vi.fn(),
  generateVideo: vi.fn(),
}))

const configMock = vi.hoisted(() => ({
  getProjectModelConfig: vi.fn(),
  getUserModelConfig: vi.fn(),
  resolveProjectModelCapabilityGenerationOptions: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/service', () => taskServiceMock)
vi.mock('@/lib/ai-exec/async-poll', () => asyncPollMock)
vi.mock('@/lib/ai-exec/engine', () => generatorApiMock)
vi.mock('@/lib/storage', () => ({
  getSignedUrl: vi.fn((value: string) => value),
  toFetchableUrl: vi.fn((value: string) => value),
}))
vi.mock('@/lib/media-process', () => ({ processMediaResult: vi.fn() }))
vi.mock('@/lib/config-service', () => ({
  getProjectModelConfig: configMock.getProjectModelConfig,
  getUserModelConfig: configMock.getUserModelConfig,
  resolveProjectModelCapabilityGenerationOptions: configMock.resolveProjectModelCapabilityGenerationOptions,
}))

import { resolveImageSourceFromGeneration, resolveVideoSourceFromGeneration } from '@/lib/workers/utils'

function buildJob(): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-1',
      type: 'VIDEO_PANEL',
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'ProjectPanel',
      targetId: 'panel-1',
      payload: {},
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker utils video generation resume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configMock.resolveProjectModelCapabilityGenerationOptions.mockResolvedValue({})
  })

  it('continues polling from existing externalId without re-submitting generation', async () => {
    const externalId = 'FAL:VIDEO:fal-ai/kling-video/v2.1/master/image-to-video:req_123'
    prismaMock.task.findUnique.mockResolvedValueOnce({ externalId })
    asyncPollMock.pollAsyncTask.mockResolvedValueOnce({
      status: 'completed',
      resultUrl: 'https://fal.test/videos/req_123.mp4',
    })

    const result = await resolveVideoSourceFromGeneration(buildJob(), {
      userId: 'user-1',
      modelId: 'fal::fal-ai/kling-video/v2.1/master/image-to-video',
      imageUrl: 'data:image/png;base64,QQ==',
      options: {
        prompt: 'animate this frame',
      },
    })

    expect(result).toEqual({
      url: 'https://fal.test/videos/req_123.mp4',
    })
    expect(asyncPollMock.pollAsyncTask).toHaveBeenCalledWith(externalId, 'user-1')
    expect(generatorApiMock.generateVideo).not.toHaveBeenCalled()
  })

  it('prevents duplicate panel candidates by skipping task externalId resume when requested', async () => {
    prismaMock.task.findUnique.mockResolvedValueOnce({ externalId: 'FAL:IMAGE:fal-ai/nano-banana-pro:req_1' })
    generatorApiMock.generateImage.mockResolvedValueOnce({
      success: true,
      imageUrl: 'https://fal.test/new-image.png',
    })

    const result = await resolveImageSourceFromGeneration(buildJob(), {
      userId: 'user-1',
      modelId: 'fal::banana',
      prompt: 'a cinematic portrait',
      options: {
        aspectRatio: '16:9',
      },
      allowTaskExternalIdResume: false,
    })

    expect(result).toBe('https://fal.test/new-image.png')
    expect(prismaMock.task.findUnique).not.toHaveBeenCalled()
    expect(asyncPollMock.pollAsyncTask).not.toHaveBeenCalled()
    expect(generatorApiMock.generateImage).toHaveBeenCalledTimes(1)
  })

  it('passes image quality runtime selection through capability resolution and generation options', async () => {
    configMock.resolveProjectModelCapabilityGenerationOptions.mockResolvedValueOnce({
      resolution: '4K',
      quality: 'medium',
    })
    generatorApiMock.generateImage.mockResolvedValueOnce({
      success: true,
      imageUrl: 'https://fal.test/quality-image.png',
    })

    const result = await resolveImageSourceFromGeneration(buildJob(), {
      userId: 'user-1',
      modelId: 'fal::gpt-image-2',
      prompt: 'enhance this image',
      options: {
        aspectRatio: '16:9',
        quality: 'medium',
      },
      allowTaskExternalIdResume: false,
    })

    expect(result).toBe('https://fal.test/quality-image.png')
    expect(configMock.resolveProjectModelCapabilityGenerationOptions).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      modelType: 'image',
      modelKey: 'fal::gpt-image-2',
      runtimeSelections: {
        quality: 'medium',
      },
    })
    expect(generatorApiMock.generateImage).toHaveBeenCalledWith(
      'user-1',
      'fal::gpt-image-2',
      'enhance this image',
      expect.objectContaining({
        aspectRatio: '16:9',
        resolution: '4K',
        quality: 'medium',
      }),
    )
  })
})
