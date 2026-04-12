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

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/service', () => taskServiceMock)
vi.mock('@/lib/async-poll', () => asyncPollMock)
vi.mock('@/lib/generator-api', () => generatorApiMock)
vi.mock('@/lib/lipsync', () => ({ generateLipSync: vi.fn() }))
vi.mock('@/lib/storage', () => ({
  getSignedUrl: vi.fn((value: string) => value),
  toFetchableUrl: vi.fn((value: string) => value),
}))
vi.mock('@/lib/fonts', () => ({ initializeFonts: vi.fn(), createLabelSVG: vi.fn() }))
vi.mock('@/lib/media-process', () => ({ processMediaResult: vi.fn() }))
vi.mock('@/lib/config-service', () => ({
  getProjectModelConfig: vi.fn(),
  getUserModelConfig: vi.fn(),
  resolveProjectModelCapabilityGenerationOptions: vi.fn(),
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
      targetType: 'NovelPromotionPanel',
      targetId: 'panel-1',
      payload: {},
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker utils video generation resume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('continues polling from existing externalId without re-submitting generation', async () => {
    const externalId = 'OPENAI:VIDEO:b3BlbmFpLWNvbXBhdGlibGU6b2EtMQ:vid_123'
    prismaMock.task.findUnique.mockResolvedValueOnce({ externalId })
    asyncPollMock.pollAsyncTask.mockResolvedValueOnce({
      status: 'completed',
      resultUrl: 'https://oa.test/v1/videos/vid_123/content',
      downloadHeaders: {
        Authorization: 'Bearer oa-key',
      },
    })

    const result = await resolveVideoSourceFromGeneration(buildJob(), {
      userId: 'user-1',
      modelId: 'openai-compatible:oa-1::sora-2',
      imageUrl: 'data:image/png;base64,QQ==',
      options: {
        prompt: 'animate this frame',
      },
    })

    expect(result).toEqual({
      url: 'https://oa.test/v1/videos/vid_123/content',
      downloadHeaders: {
        Authorization: 'Bearer oa-key',
      },
    })
    expect(asyncPollMock.pollAsyncTask).toHaveBeenCalledWith(externalId, 'user-1')
    expect(generatorApiMock.generateVideo).not.toHaveBeenCalled()
  })

  it('does not resume ComfyUI video generation from an old externalId after restart', async () => {
    prismaMock.task.findUnique.mockResolvedValueOnce({ externalId: 'COMFYUI:VIDEO:old_prompt_id' })
    generatorApiMock.generateVideo.mockResolvedValueOnce({
      success: true,
      videoUrl: 'https://comfy.test/new-video.mp4',
    })

    const result = await resolveVideoSourceFromGeneration(buildJob(), {
      userId: 'user-1',
      modelId: 'comfyui::basevideo/图生视频/ltx2.3-图生视频-没字幕版',
      imageUrl: 'data:image/png;base64,QQ==',
      options: {
        prompt: 'animate this frame',
      },
    })

    expect(result).toEqual({
      url: 'https://comfy.test/new-video.mp4',
    })
    expect(prismaMock.task.findUnique).not.toHaveBeenCalled()
    expect(asyncPollMock.pollAsyncTask).not.toHaveBeenCalled()
    expect(generatorApiMock.generateVideo).toHaveBeenCalledTimes(1)
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

  it('does not resume ComfyUI image generation from an old externalId after restart', async () => {
    prismaMock.task.findUnique.mockResolvedValueOnce({ externalId: 'COMFYUI:IMAGE:old_prompt_id' })
    generatorApiMock.generateImage.mockResolvedValueOnce({
      success: true,
      imageUrl: 'https://comfy.test/new-image.png',
    })

    const result = await resolveImageSourceFromGeneration(buildJob(), {
      userId: 'user-1',
      modelId: 'comfyui::baseimage/图片分镜/Qwen剧情分镜制作',
      prompt: 'a cinematic portrait',
      options: {
        aspectRatio: '16:9',
      },
    })

    expect(result).toBe('https://comfy.test/new-image.png')
    expect(prismaMock.task.findUnique).not.toHaveBeenCalled()
    expect(asyncPollMock.pollAsyncTask).not.toHaveBeenCalled()
    expect(generatorApiMock.generateImage).toHaveBeenCalledTimes(1)
  })
})
