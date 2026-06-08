import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

type GenerationInput = {
  job: Job<TaskJobData>
  userId: string
  modelId: string
  prompt: string
  targetId: string
  keyPrefix: string
  options: {
    aspectRatio: string
    resolution?: string
    quality?: string
    size?: string
  }
}

const prismaMock = vi.hoisted(() => ({
  projectEditStylePreview: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  projectEditScreenplay: {
    update: vi.fn(async () => ({})),
  },
}))

const sharedMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
}))

const handlerSharedMock = vi.hoisted(() => ({
  generateCleanImageToStorage: vi.fn<(input: GenerationInput) => Promise<string>>(async () => 'edit-style-preview/preview-1.png'),
}))

const storageMock = vi.hoisted(() => ({
  getSignedUrl: vi.fn((key: string) => `https://signed.example/${key}`),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/shared', () => sharedMock)
vi.mock('@/lib/workers/handlers/image-task-handler-shared', () => handlerSharedMock)
vi.mock('@/lib/storage', () => storageMock)

import { handleEditStylePreviewImageTask } from '@/lib/workers/handlers/edit-style-preview-image-task-handler'

function buildJob(payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-style-preview-1',
      type: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'ProjectEditStylePreview',
      targetId: 'preview-1',
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker edit-style-preview-image-task-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.projectEditStylePreview.findFirst.mockResolvedValue({
      id: 'preview-1',
      editScreenplayId: 'screenplay-1',
    })
    prismaMock.projectEditStylePreview.findMany.mockResolvedValue([
      { status: 'completed' },
      { status: 'completed' },
      { status: 'completed' },
    ])
  })

  it('generates a 3x3 style preview image and marks the screenplay preview-ready when all options completed', async () => {
    const job = buildJob({
      stylePreviewId: 'preview-1',
      imageModel: 'storyboard-image-model',
      prompt: 'single image, 3x3 grid, nine cinematic frames',
      generationOptions: { resolution: '1K', quality: 'high', size: '1024x1024' },
    })

    const result = await handleEditStylePreviewImageTask(job)

    expect(handlerSharedMock.generateCleanImageToStorage).toHaveBeenCalledWith(expect.objectContaining({
      job,
      userId: 'user-1',
      modelId: 'storyboard-image-model',
      prompt: 'single image, 3x3 grid, nine cinematic frames',
      targetId: 'preview-1',
      keyPrefix: 'edit-style-preview',
      options: {
        aspectRatio: '16:9',
        resolution: '1K',
        quality: 'high',
      },
    }))
    expect(prismaMock.projectEditStylePreview.update).toHaveBeenCalledWith({
      where: { id: 'preview-1' },
      data: {
        imageKey: 'edit-style-preview/preview-1.png',
        status: 'completed',
        errorMessage: null,
      },
    })
    expect(prismaMock.projectEditScreenplay.update).toHaveBeenCalledWith({
      where: { id: 'screenplay-1' },
      data: { status: 'style_preview_ready' },
    })
    expect(result).toEqual({
      stylePreviewId: 'preview-1',
      imageKey: 'edit-style-preview/preview-1.png',
      imageUrl: 'https://signed.example/edit-style-preview/preview-1.png',
      prompt: 'single image, 3x3 grid, nine cinematic frames',
      aspectRatio: '16:9',
      targetResolution: '1920x1080',
    })
  })

  it('marks only the failed preview when image generation fails', async () => {
    handlerSharedMock.generateCleanImageToStorage.mockRejectedValueOnce(new Error('IMAGE_PROVIDER_FAILED'))

    await expect(handleEditStylePreviewImageTask(buildJob({
      imageModel: 'storyboard-image-model',
      prompt: 'single image, 3x3 grid',
    }))).rejects.toThrow('IMAGE_PROVIDER_FAILED')

    expect(prismaMock.projectEditStylePreview.update).toHaveBeenLastCalledWith({
      where: { id: 'preview-1' },
      data: {
        status: 'failed',
        errorMessage: 'IMAGE_PROVIDER_FAILED',
      },
    })
    expect(prismaMock.projectEditScreenplay.update).not.toHaveBeenCalled()
  })
})
