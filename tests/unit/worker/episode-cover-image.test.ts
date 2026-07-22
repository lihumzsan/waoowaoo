import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CODEX_DEFAULT_IMAGE_MODEL_KEY } from '@/lib/providers/codex/constants'
import type { TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  task: {
    findUnique: vi.fn(async () => null),
  },
}))

const utilsMock = vi.hoisted(() => ({
  uploadImageSourceToCosWithMetadata: vi.fn(),
}))

const configServiceMock = vi.hoisted(() => ({
  getProjectModelConfig: vi.fn(),
  resolveProjectModelCapabilityGenerationOptions: vi.fn(async () => ({})),
}))

const generatorApiMock = vi.hoisted(() => ({
  generateImage: vi.fn(async () => ({
    success: true,
    imageUrl: 'generated-cover-source',
  })),
  generateVideo: vi.fn(),
}))

const taskServiceMock = vi.hoisted(() => ({
  isTaskActive: vi.fn(async () => true),
}))

const sharedMock = vi.hoisted(() => ({
  resolveNovelData: vi.fn(async () => ({
    videoRatio: '16:9',
    characters: [],
    locations: [],
  })),
  collectPanelReferenceImages: vi.fn(async (_projectData, panel: { id?: string }) => (
    panel.id === 'panel-1'
      ? [
          'images/hero.png',
          'images/old-town.png',
          'images/companion.png',
          'images/overflow.png',
        ]
      : ['images/hero.png']
  )),
}))

const outboundMock = vi.hoisted(() => ({
  normalizeReferenceImagesForGeneration: vi.fn(async (refs: string[]) => (
    refs.map((ref) => `normalized:${ref}`)
  )),
}))

const mediaMock = vi.hoisted(() => ({
  ensureMediaObjectFromStorageKey: vi.fn(),
}))

const auditMock = vi.hoisted(() => ({
  auditEpisodeCoverImage: vi.fn(),
}))

const promptMock = vi.hoisted(() => ({
  buildPrompt: vi.fn(() => 'episode cover base prompt'),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/generator-api', () => generatorApiMock)
vi.mock('@/lib/task/service', () => taskServiceMock)
vi.mock('@/lib/workers/utils', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workers/utils')>('@/lib/workers/utils')
  return {
    ...actual,
    uploadImageSourceToCosWithMetadata: utilsMock.uploadImageSourceToCosWithMetadata,
  }
})
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/workers/handlers/image-task-handler-shared', () => sharedMock)
vi.mock('@/lib/media/outbound-image', () => outboundMock)
vi.mock('@/lib/media/service', () => mediaMock)
vi.mock('@/lib/novel-promotion/episode-cover/audit', () => auditMock)
vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: { NP_EPISODE_COVER_IMAGE: 'np_episode_cover_image' },
  buildPrompt: promptMock.buildPrompt,
}))

function buildJob(): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-cover-1',
      type: 'image_episode_cover' as TaskJobData['type'],
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionEpisode',
      targetId: 'episode-1',
      payload: {},
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

function buildEpisode(coverImageMediaId: string | null = null) {
  return {
    id: 'episode-1',
    novelPromotionProjectId: 'novel-data-1',
    coverImageMediaId,
    description: 'A lone hero returns to the old town at night.',
    novelText: 'The hero sees the abandoned clock tower and makes a decision.',
    clips: [
      {
        summary: 'Return to the old town',
        content: 'The hero walks through rain toward the clock tower.',
        screenplay: '{"scene":"old town confrontation"}',
      },
    ],
    storyboards: [
      {
        panels: [
          {
            id: 'panel-1',
            panelIndex: 0,
            description: 'Hero beneath the clock tower in heavy rain',
            imagePrompt: 'cinematic night rain',
            location: 'Old Town',
            characters: '[{"name":"Hero"}]',
            srtSegment: 'I came back to finish this.',
          },
          {
            id: 'panel-2',
            panelIndex: 1,
            description: 'The clock face cracks as lightning flashes',
            imagePrompt: 'lightning over broken clock',
            location: 'Old Town',
            characters: '[]',
            srtSegment: null,
          },
        ],
      },
    ],
  }
}

async function loadHandler() {
  return await import('@/lib/workers/handlers/episode-cover-image-task-handler')
}

describe('worker episode cover image behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generatorApiMock.generateImage.mockResolvedValue({
      success: true,
      imageUrl: 'generated-cover-source',
    })
    configServiceMock.getProjectModelConfig.mockResolvedValue({
      storyboardModel: 'other-provider::ignored-model',
      videoRatio: '16:9',
      artStyle: 'realistic',
    })
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(buildEpisode())
    prismaMock.novelPromotionEpisode.update.mockResolvedValue({ id: 'episode-1' })
    utilsMock.uploadImageSourceToCosWithMetadata.mockResolvedValue({
      key: 'images/episode-cover/episode-1.png',
      metadata: {
        mimeType: 'image/png',
        sizeBytes: 1024,
        width: 1280,
        height: 720,
      },
    })
    mediaMock.ensureMediaObjectFromStorageKey.mockResolvedValue({
      id: 'media-cover-1',
      publicId: 'episode-cover-public-1',
      url: '/m/episode-cover-public-1',
    })
    auditMock.auditEpisodeCoverImage.mockResolvedValue({
      buffer: Buffer.from('audited-cover-bytes'),
      metadata: {
        mimeType: 'image/png',
        sizeBytes: 19,
        width: 1280,
        height: 720,
      },
    })
  })

  it('generates one text-free Codex cover from current Episode context and selected references', async () => {
    const { handleEpisodeCoverImageTask } = await loadHandler()

    const result = await handleEpisodeCoverImageTask(buildJob())

    expect(promptMock.buildPrompt).toHaveBeenCalledWith({
      promptId: 'np_episode_cover_image',
      locale: 'zh',
      variables: {
        aspect_ratio: '16:9',
        episode_context: expect.stringContaining('abandoned clock tower'),
        style: expect.any(String),
      },
    })
    expect(generatorApiMock.generateImage).toHaveBeenCalledWith(
      'user-1',
      CODEX_DEFAULT_IMAGE_MODEL_KEY,
      'episode cover base prompt',
      expect.objectContaining({
        aspectRatio: '16:9',
        referenceImages: [
          'normalized:images/hero.png',
          'normalized:images/old-town.png',
          'normalized:images/companion.png',
        ],
      }),
    )
    expect(generatorApiMock.generateVideo).not.toHaveBeenCalled()
    expect(auditMock.auditEpisodeCoverImage).toHaveBeenCalledWith({
      userId: 'user-1',
      projectId: 'project-1',
      imageSource: 'generated-cover-source',
      expectedAspectRatio: '16:9',
    })
    expect(utilsMock.uploadImageSourceToCosWithMetadata).toHaveBeenCalledWith(
      Buffer.from('audited-cover-bytes'),
      'episode-cover',
      'episode-1',
    )
    expect(auditMock.auditEpisodeCoverImage.mock.invocationCallOrder[0]).toBeLessThan(
      utilsMock.uploadImageSourceToCosWithMetadata.mock.invocationCallOrder[0]!,
    )
    expect(prismaMock.novelPromotionEpisode.update).toHaveBeenCalledWith({
      where: { id: 'episode-1' },
      data: { coverImageMediaId: 'media-cover-1' },
    })
    expect(result).toEqual({
      episodeId: 'episode-1',
      coverImageMediaId: 'media-cover-1',
      coverImageUrl: '/m/episode-cover-public-1',
    })
  })

  it('generates a Codex cover without a project storyboard model', async () => {
    configServiceMock.getProjectModelConfig.mockResolvedValue({
      videoRatio: '16:9',
      artStyle: 'realistic',
    })
    const { handleEpisodeCoverImageTask } = await loadHandler()

    await expect(handleEpisodeCoverImageTask(buildJob())).resolves.toEqual({
      episodeId: 'episode-1',
      coverImageMediaId: 'media-cover-1',
      coverImageUrl: '/m/episode-cover-public-1',
    })

    expect(generatorApiMock.generateImage).toHaveBeenCalledWith(
      'user-1',
      CODEX_DEFAULT_IMAGE_MODEL_KEY,
      expect.any(String),
      expect.any(Object),
    )
    expect(generatorApiMock.generateVideo).not.toHaveBeenCalled()
  })

  it('preserves the existing cover pointer when regeneration fails', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(buildEpisode('media-old-cover'))
    generatorApiMock.generateImage.mockRejectedValue(new Error('provider unavailable'))
    const { handleEpisodeCoverImageTask } = await loadHandler()

    await expect(handleEpisodeCoverImageTask(buildJob())).rejects.toThrow('provider unavailable')

    expect(mediaMock.ensureMediaObjectFromStorageKey).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionEpisode.update).not.toHaveBeenCalled()
  })

  it('creates no storage object, media row, or pointer update when audit fails', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(buildEpisode('media-old-cover'))
    auditMock.auditEpisodeCoverImage.mockRejectedValue(new Error('EPISODE_COVER_IMAGE_SEMANTIC_AUDIT_FAILED'))
    const { handleEpisodeCoverImageTask } = await loadHandler()

    await expect(handleEpisodeCoverImageTask(buildJob())).rejects.toThrow('EPISODE_COVER_IMAGE_SEMANTIC_AUDIT_FAILED')

    expect(utilsMock.uploadImageSourceToCosWithMetadata).not.toHaveBeenCalled()
    expect(mediaMock.ensureMediaObjectFromStorageKey).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionEpisode.update).not.toHaveBeenCalled()
  })

  it('keeps both audit-failure attempts on Codex without a provider fallback', async () => {
    auditMock.auditEpisodeCoverImage.mockRejectedValue(new Error('EPISODE_COVER_IMAGE_SEMANTIC_AUDIT_FAILED'))
    const { handleEpisodeCoverImageTask } = await loadHandler()

    await expect(handleEpisodeCoverImageTask(buildJob())).rejects.toThrow('EPISODE_COVER_IMAGE_SEMANTIC_AUDIT_FAILED')
    await expect(handleEpisodeCoverImageTask(buildJob())).rejects.toThrow('EPISODE_COVER_IMAGE_SEMANTIC_AUDIT_FAILED')

    expect(generatorApiMock.generateImage).toHaveBeenCalledTimes(2)
    expect(generatorApiMock.generateImage).toHaveBeenNthCalledWith(
      1,
      'user-1',
      CODEX_DEFAULT_IMAGE_MODEL_KEY,
      expect.any(String),
      expect.any(Object),
    )
    expect(generatorApiMock.generateImage).toHaveBeenNthCalledWith(
      2,
      'user-1',
      CODEX_DEFAULT_IMAGE_MODEL_KEY,
      expect.any(String),
      expect.any(Object),
    )
    expect(generatorApiMock.generateVideo).not.toHaveBeenCalled()
  })
})
