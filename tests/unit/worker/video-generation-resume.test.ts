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

const configServiceMock = vi.hoisted(() => ({
  getProjectModelConfig: vi.fn(),
  getUserModelConfig: vi.fn(),
  resolveProjectModelCapabilityGenerationOptions: vi.fn(),
}))

const storageMock = vi.hoisted(() => ({
  getSignedUrl: vi.fn((value: string) => value),
  toFetchableUrl: vi.fn((value: string) => (
    value.startsWith('/api/storage/sign')
      ? `http://internal.test${value}`
      : value
  )),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/service', () => taskServiceMock)
vi.mock('@/lib/async-poll', () => asyncPollMock)
vi.mock('@/lib/generator-api', () => generatorApiMock)
vi.mock('@/lib/lipsync', () => ({ generateLipSync: vi.fn() }))
vi.mock('@/lib/storage', () => storageMock)
vi.mock('@/lib/fonts', () => ({ initializeFonts: vi.fn(), createLabelSVG: vi.fn() }))
vi.mock('@/lib/media-process', () => ({ processMediaResult: vi.fn() }))
vi.mock('@/lib/config-service', () => configServiceMock)

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
    configServiceMock.getProjectModelConfig.mockResolvedValue({ analysisModel: null })
    configServiceMock.resolveProjectModelCapabilityGenerationOptions.mockResolvedValue({})
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
      modelId: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
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

  it('preserves ComfyUI stream metadata for worker-side persistence', async () => {
    generatorApiMock.generateVideo.mockResolvedValueOnce({
      success: true,
      videoUrl: 'https://comfy.test/view?filename=generated.mp4&type=output',
      videoStream: {
        mimeType: 'video/mp4',
        contentLength: 987,
      },
    })

    const result = await resolveVideoSourceFromGeneration(buildJob(), {
      userId: 'user-1',
      modelId: 'comfyui::basevideo/seedance2/bernini-480p-i2v',
      imageUrl: 'data:image/png;base64,QQ==',
      options: {
        prompt: 'animate this frame',
      },
    })

    expect(result).toEqual({
      url: 'https://comfy.test/view?filename=generated.mp4&type=output',
      stream: {
        mimeType: 'video/mp4',
        contentLength: 987,
      },
    })
  })

  it('preserves ComfyUI first-last routing and the tail image for provider submission', async () => {
    configServiceMock.resolveProjectModelCapabilityGenerationOptions.mockResolvedValueOnce({
      duration: 10,
      fps: 24,
      generationMode: 'firstlastframe',
    })
    generatorApiMock.generateVideo.mockResolvedValueOnce({
      success: true,
      videoUrl: 'https://comfy.test/first-last.mp4',
    })

    await resolveVideoSourceFromGeneration(buildJob(), {
      userId: 'user-1',
      modelId: 'comfyui::basevideo/ltx23-profiles/goon-first-last-frame-2stage',
      imageUrl: 'data:image/png;base64,RklSU1Q=',
      options: {
        prompt: 'transition into the supplied tail frame',
        duration: 10,
        fps: 24,
        generationMode: 'firstlastframe',
        lastFrameImageUrl: 'data:image/png;base64,TEFTVA==',
      },
    })

    expect(generatorApiMock.generateVideo).toHaveBeenCalledWith(
      'user-1',
      'comfyui::basevideo/ltx23-profiles/goon-first-last-frame-2stage',
      'data:image/png;base64,RklSU1Q=',
      expect.objectContaining({
        generationMode: 'firstlastframe',
        lastFrameImageUrl: 'data:image/png;base64,TEFTVA==',
      }),
    )
  })

  it('validates custom audio-driven ComfyUI durations against the next allowed duration but submits the exact duration', async () => {
    configServiceMock.resolveProjectModelCapabilityGenerationOptions.mockImplementationOnce(async (input: {
      runtimeSelections?: Record<string, unknown>
    }) => {
      if (input.runtimeSelections?.duration !== 12) {
        throw new Error(`CAPABILITY_VALUE_NOT_ALLOWED: duration ${String(input.runtimeSelections?.duration)}`)
      }
      return {
        duration: 12,
        resolution: '720p',
        generationMode: 'normal',
      }
    })
    generatorApiMock.generateVideo.mockResolvedValueOnce({
      success: true,
      videoUrl: 'https://comfy.test/exact-duration.mp4',
    })

    const result = await resolveVideoSourceFromGeneration(buildJob(), {
      userId: 'user-1',
      modelId: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
      imageUrl: 'data:image/png;base64,QQ==',
      allowCustomDuration: true,
      options: {
        prompt: 'animate this frame',
        duration: 11.43,
        resolution: '720p',
        generationMode: 'normal',
      },
    })

    expect(result).toEqual({ url: 'https://comfy.test/exact-duration.mp4' })
    expect(configServiceMock.resolveProjectModelCapabilityGenerationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeSelections: expect.objectContaining({
          duration: 12,
        }),
      }),
    )
    expect(generatorApiMock.generateVideo).toHaveBeenCalledWith(
      'user-1',
      'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
      'data:image/png;base64,QQ==',
      expect.objectContaining({
        duration: 11.43,
        resolution: '720p',
        prompt: 'animate this frame',
      }),
    )
  })

  it.each([6, 16])(
    'validates exact Bernini duration %ss with a catalog preset but submits the exact duration',
    async (duration) => {
      configServiceMock.resolveProjectModelCapabilityGenerationOptions.mockImplementationOnce(async (input: {
        runtimeSelections?: Record<string, unknown>
      }) => {
        expect(input.runtimeSelections).toEqual(expect.objectContaining({
          duration: 10,
          fps: 24,
          generationMode: 'normal',
          motionStrength: 1,
          resolution: '480p',
        }))
        return {
          duration: 10,
          fps: 24,
          generationMode: 'normal',
          motionStrength: 1,
          resolution: '480p',
        }
      })
      generatorApiMock.generateVideo.mockResolvedValueOnce({
        success: true,
        videoUrl: `https://comfy.test/seedance2-bernini-${duration}s.mp4`,
      })

      const result = await resolveVideoSourceFromGeneration(buildJob(), {
        userId: 'user-1',
        modelId: 'comfyui::basevideo/seedance2/bernini-480p-i2v',
        imageUrl: 'data:image/png;base64,QQ==',
        allowCustomDuration: true,
        options: {
          prompt: 'animate this frame',
          duration,
          fps: 24,
          generationMode: 'normal',
          motionStrength: 1,
          resolution: '480p',
        },
      })

      expect(result).toEqual({ url: `https://comfy.test/seedance2-bernini-${duration}s.mp4` })
      expect(generatorApiMock.generateVideo).toHaveBeenCalledWith(
        'user-1',
        'comfyui::basevideo/seedance2/bernini-480p-i2v',
        'data:image/png;base64,QQ==',
        expect.objectContaining({
          duration,
          fps: 24,
          motionStrength: 1,
          prompt: 'animate this frame',
          resolution: '480p',
        }),
      )
    },
  )

  it('passes Seedance2 Bernini fps and motion strength into worker capability validation', async () => {
    configServiceMock.resolveProjectModelCapabilityGenerationOptions.mockImplementationOnce(async (input: {
      runtimeSelections?: Record<string, unknown>
    }) => {
      expect(input.runtimeSelections).toEqual(expect.objectContaining({
        duration: 5,
        fps: 24,
        generationMode: 'normal',
        motionStrength: 2,
        resolution: '480p',
      }))
      return {
        duration: 5,
        fps: 24,
        generationMode: 'normal',
        motionStrength: 2,
        resolution: '480p',
      }
    })
    generatorApiMock.generateVideo.mockResolvedValueOnce({
      success: true,
      videoUrl: 'https://comfy.test/seedance2-bernini.mp4',
    })

    const result = await resolveVideoSourceFromGeneration(buildJob(), {
      userId: 'user-1',
      modelId: 'comfyui::basevideo/seedance2/bernini-480p-i2v',
      imageUrl: 'data:image/png;base64,QQ==',
      options: {
        prompt: 'animate this frame',
        duration: 5,
        fps: 24,
        generationMode: 'normal',
        motionStrength: 2,
        resolution: '480p',
      },
    })

    expect(result).toEqual({ url: 'https://comfy.test/seedance2-bernini.mp4' })
    expect(generatorApiMock.generateVideo).toHaveBeenCalledWith(
      'user-1',
      'comfyui::basevideo/seedance2/bernini-480p-i2v',
      'data:image/png;base64,QQ==',
      expect.objectContaining({
        duration: 5,
        fps: 24,
        motionStrength: 2,
        prompt: 'animate this frame',
        resolution: '480p',
      }),
    )
  })

  it('proxies an exact KJ duration above presets only during worker capability validation', async () => {
    configServiceMock.resolveProjectModelCapabilityGenerationOptions.mockImplementationOnce(async (input: {
      runtimeSelections?: Record<string, unknown>
    }) => {
      expect(input.runtimeSelections).toEqual(expect.objectContaining({
        duration: 20,
        fps: 25,
        generationMode: 'normal',
        motionStrength: 1,
        resolution: '720p',
      }))
      return {
        duration: 20,
        fps: 25,
        generationMode: 'normal',
        motionStrength: 1,
        resolution: '720p',
      }
    })
    generatorApiMock.generateVideo.mockResolvedValueOnce({
      success: true,
      videoUrl: 'https://comfy.test/ltx23-kj-21s.mp4',
    })

    const result = await resolveVideoSourceFromGeneration(buildJob(), {
      userId: 'user-1',
      modelId: 'comfyui::basevideo/ltx23-profiles/t8-multishot-precise-promptrelay-kj-720p',
      imageUrl: 'data:image/png;base64,QQ==',
      allowCustomDuration: true,
      options: {
        prompt: 'GLOBAL: office\nLOCAL 1: prepare\nLOCAL 2: move\nLOCAL 3: settle',
        duration: 21,
        fps: 25,
        generationMode: 'normal',
        motionStrength: 1,
        resolution: '720p',
      },
    })

    expect(result).toEqual({ url: 'https://comfy.test/ltx23-kj-21s.mp4' })
    expect(generatorApiMock.generateVideo).toHaveBeenCalledWith(
      'user-1',
      'comfyui::basevideo/ltx23-profiles/t8-multishot-precise-promptrelay-kj-720p',
      'data:image/png;base64,QQ==',
      expect.objectContaining({
        duration: 21,
        fps: 25,
        motionStrength: 1,
        resolution: '720p',
      }),
    )
  })

  it('normalizes relative signed reference audio URLs before provider submission', async () => {
    generatorApiMock.generateVideo.mockResolvedValueOnce({
      success: true,
      videoUrl: 'https://comfy.test/audio-driven.mp4',
    })

    const result = await resolveVideoSourceFromGeneration(buildJob(), {
      userId: 'user-1',
      modelId: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
      imageUrl: 'data:image/png;base64,QQ==',
      options: {
        prompt: 'doctor speaks with matched voice timing',
        referenceAudioUrls: ['/api/storage/sign?key=voice%2Fline-1.flac&expires=7200'],
      },
    })

    expect(result).toEqual({ url: 'https://comfy.test/audio-driven.mp4' })
    expect(storageMock.toFetchableUrl).toHaveBeenCalledWith('/api/storage/sign?key=voice%2Fline-1.flac&expires=7200')
    expect(generatorApiMock.generateVideo).toHaveBeenCalledWith(
      'user-1',
      'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
      'data:image/png;base64,QQ==',
      expect.objectContaining({
        referenceAudioUrls: ['http://internal.test/api/storage/sign?key=voice%2Fline-1.flac&expires=7200'],
      }),
    )
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
