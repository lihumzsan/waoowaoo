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
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  projectEditBible: {
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
vi.mock('@/lib/workers/handlers/image-task-handler-shared', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workers/handlers/image-task-handler-shared')>(
    '@/lib/workers/handlers/image-task-handler-shared',
  )
  return {
    ...actual,
    generateCleanImageToStorage: handlerSharedMock.generateCleanImageToStorage,
  }
})
vi.mock('@/lib/storage', () => storageMock)

import { handleEditStylePreviewImageTask } from '@/lib/workers/handlers/edit-style-preview-image-task-handler'

function buildJob(payload: Record<string, unknown>): Job<TaskJobData> {
  const generationOptions = payload.generationOptions && typeof payload.generationOptions === 'object'
    ? payload.generationOptions
    : { aspectRatio: '16:9', resolution: '1K', quality: 'high' }
  return {
    data: {
      taskId: 'task-style-preview-1',
      type: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'ProjectEditStylePreview',
      targetId: 'preview-1',
      payload: {
        generationOptions,
        ...payload,
      },
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker edit-style-preview-image-task-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.projectEditStylePreview.findFirst.mockResolvedValue({
      id: 'preview-1',
      editBibleId: 'bible-1',
      status: 'pending',
      imageKey: null,
    })
    prismaMock.projectEditStylePreview.findMany.mockResolvedValue([
      { status: 'completed' },
      { status: 'completed' },
      { status: 'completed' },
    ])
    prismaMock.projectEditStylePreview.updateMany.mockResolvedValue({ count: 1 })
  })

  it('generates a 3x3 style preview image without mutating the parent bible status', async () => {
    const job = buildJob({
      stylePreviewId: 'preview-1',
      imageModel: 'storyboard-image-model',
      prompt: 'single image, 3x3 grid, nine cinematic frames',
      generationOptions: { aspectRatio: '16:9', resolution: '1K', quality: 'high' },
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
    expect(prismaMock.projectEditStylePreview.updateMany).toHaveBeenCalledWith({
      where: { id: 'preview-1', taskId: 'task-style-preview-1', status: 'generating' },
      data: {
        imageKey: 'edit-style-preview/preview-1.png',
        status: 'completed',
        errorMessage: null,
      },
    })
    expect(prismaMock.projectEditBible.update).not.toHaveBeenCalled()
    expect(result).toEqual({
      stylePreviewId: 'preview-1',
      imageKey: 'edit-style-preview/preview-1.png',
      imageUrl: 'https://signed.example/edit-style-preview/preview-1.png',
      prompt: 'single image, 3x3 grid, nine cinematic frames',
      aspectRatio: '16:9',
      targetResolution: '1920x1080',
    })
  })

  it('leaves bible status unchanged when fewer than three sibling previews exist', async () => {
    prismaMock.projectEditStylePreview.findMany.mockResolvedValueOnce([
      { status: 'completed' },
      { status: 'completed' },
    ])

    await handleEditStylePreviewImageTask(buildJob({
      stylePreviewId: 'preview-1',
      imageModel: 'storyboard-image-model',
      prompt: 'single image, 3x3 grid',
    }))

    expect(prismaMock.projectEditBible.update).not.toHaveBeenCalled()
  })

  it('leaves bible status unchanged after appended candidates complete', async () => {
    prismaMock.projectEditStylePreview.findMany.mockResolvedValueOnce([
      { status: 'completed' },
      { status: 'completed' },
      { status: 'completed' },
      { status: 'completed' },
      { status: 'completed' },
    ])

    await handleEditStylePreviewImageTask(buildJob({
      stylePreviewId: 'preview-1',
      imageModel: 'storyboard-image-model',
      prompt: 'single image, 3x3 grid',
    }))

    expect(prismaMock.projectEditBible.update).not.toHaveBeenCalled()
  })

  it('does not mark preview-ready while an appended candidate is still generating', async () => {
    prismaMock.projectEditStylePreview.findMany.mockResolvedValueOnce([
      { status: 'completed' },
      { status: 'completed' },
      { status: 'completed' },
      { status: 'completed' },
      { status: 'generating' },
    ])

    await handleEditStylePreviewImageTask(buildJob({
      stylePreviewId: 'preview-1',
      imageModel: 'storyboard-image-model',
      prompt: 'single image, 3x3 grid',
    }))

    expect(prismaMock.projectEditBible.update).not.toHaveBeenCalled()
  })

  it('keeps the preview generating when an attempt fails before retry policy runs', async () => {
    handlerSharedMock.generateCleanImageToStorage.mockRejectedValueOnce(new Error('IMAGE_PROVIDER_FAILED'))

    await expect(handleEditStylePreviewImageTask(buildJob({
      imageModel: 'storyboard-image-model',
      prompt: 'single image, 3x3 grid',
    }))).rejects.toThrow('IMAGE_PROVIDER_FAILED')

    expect(prismaMock.projectEditStylePreview.updateMany).toHaveBeenCalledWith({
      where: { id: 'preview-1', taskId: 'task-style-preview-1', status: { in: ['pending', 'generating'] } },
      data: {
        status: 'generating',
        taskId: 'task-style-preview-1',
        errorMessage: null,
      },
    })
    expect(prismaMock.projectEditStylePreview.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed' }),
    }))
    expect(prismaMock.projectEditBible.update).not.toHaveBeenCalled()
  })

  it('rejects an old Task before provider submission when preview ownership moved', async () => {
    prismaMock.projectEditStylePreview.findFirst.mockResolvedValueOnce(null)

    await expect(handleEditStylePreviewImageTask(buildJob({
      imageModel: 'storyboard-image-model',
      prompt: 'single image, 3x3 grid',
    }))).rejects.toThrow('EDIT_STYLE_PREVIEW_NOT_FOUND:preview-1')

    expect(handlerSharedMock.generateCleanImageToStorage).not.toHaveBeenCalled()
    expect(prismaMock.projectEditStylePreview.updateMany).not.toHaveBeenCalled()
  })

  it('replays an already persisted success without calling the provider again', async () => {
    prismaMock.projectEditStylePreview.findFirst.mockResolvedValueOnce({
      id: 'preview-1',
      status: 'completed',
      imageKey: 'edit-style-preview/preview-1.png',
    })

    const result = await handleEditStylePreviewImageTask(buildJob({
      imageModel: 'storyboard-image-model',
      prompt: 'single image, 3x3 grid',
    }))

    expect(result).toMatchObject({
      stylePreviewId: 'preview-1',
      imageKey: 'edit-style-preview/preview-1.png',
    })
    expect(handlerSharedMock.generateCleanImageToStorage).not.toHaveBeenCalled()
    expect(prismaMock.projectEditStylePreview.updateMany).not.toHaveBeenCalled()
  })
})
