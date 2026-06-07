import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { buildZenStyleBibleFixture } from '../../fixtures/edit-script-style-bible'

type WorkerProcessor = (job: Job<TaskJobData>) => Promise<unknown>

type PanelRow = {
  id: string
  videoUrl: string | null
  imageUrl: string | null
  description: string | null
  firstLastFramePrompt: string | null
  duration: number | null
}

const workerState = vi.hoisted(() => ({
  processor: null as WorkerProcessor | null,
}))

const reportTaskProgressMock = vi.hoisted(() => vi.fn(async () => undefined))
const withTaskLifecycleMock = vi.hoisted(() =>
  vi.fn(async (job: Job<TaskJobData>, handler: WorkerProcessor) => await handler(job)),
)

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getProjectModels: vi.fn(async () => ({ videoRatio: '16:9' })),
  resolveVideoSourceFromGeneration: vi.fn<(...args: unknown[]) => Promise<{ url: string; actualVideoTokens?: number; downloadHeaders?: Record<string, string> }>>(async () => ({ url: 'https://provider.example/video.mp4' })),
  toSignedUrlIfCos: vi.fn((url: string | null) => (url ? `https://signed.example/${url}` : null)),
  uploadVideoSourceToCos: vi.fn(async () => 'cos/video/video.mp4'),
}))
const configServiceMock = vi.hoisted(() => ({
  getUserWorkflowConcurrencyConfig: vi.fn(async () => ({
    analysis: 5,
    image: 5,
    video: 5,
  })),
}))
const concurrencyGateMock = vi.hoisted(() => ({
  withUserConcurrencyGate: vi.fn(async <T>(input: {
    run: () => Promise<T>
  }) => await input.run()),
}))
const videoGroupMocks = vi.hoisted(() => ({
  composeAndStoreGridReferenceImage: vi.fn(async () => ({
    id: 'reference-media-1',
    publicId: 'reference-public-1',
    url: '/m/reference-public-1',
    storageKey: 'images/video-group-reference/group-1.png',
    mimeType: 'image/png',
    sizeBytes: 1000,
    width: 1536,
    height: 1536,
    durationMs: null,
  })),
  executeAiTextStep: vi.fn(async () => ({ text: 'continuous group prompt', reasoning: '', usage: null, completion: null })),
  ensureMediaObjectFromStorageKey: vi.fn(async () => ({
    id: 'video-media-1',
    publicId: 'video-public-1',
    url: '/m/video-public-1',
    storageKey: 'group-video/group-1.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 1000,
    width: null,
    height: null,
    durationMs: 14000,
  })),
}))

const prismaMock = vi.hoisted(() => ({
  projectPanel: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(async () => undefined),
  },
  projectVideoGroup: {
    update: vi.fn(async () => undefined),
  },
  project: {
    findUnique: vi.fn(),
  },
  projectEditScript: {
    findFirst: vi.fn(),
  },
  projectEditScreenplay: {
    findFirst: vi.fn(),
  },
}))

vi.mock('bullmq', () => ({
  Queue: class {
    constructor(name: string) {
      void name
    }

    async add() {
      return { id: 'job-1' }
    }

    async getJob() {
      return null
    }
  },
  Worker: class {
    constructor(name: string, processor: WorkerProcessor) {
      void name
      workerState.processor = processor
    }
  },
}))

vi.mock('@/lib/redis', () => ({ queueRedis: {} }))
vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: reportTaskProgressMock,
  withTaskLifecycle: withTaskLifecycleMock,
}))
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/media/outbound-image', () => ({
  normalizeToBase64ForGeneration: vi.fn(async (input: string) => input),
}))
vi.mock('@/lib/ai-registry/capabilities-catalog', () => ({
  registerBuiltinCapabilityCatalogEntries: vi.fn(),
  resolveBuiltinCapabilitiesByModelKey: vi.fn(() => ({ video: { firstlastframe: true } })),
}))
vi.mock('@/lib/ai-registry/pricing-resolution', () => ({
  registerBuiltinPricingCatalogEntries: vi.fn(),
}))
vi.mock('@/lib/ai-registry/pricing-catalog', () => ({
  registerBuiltinPricingCatalogEntries: vi.fn(),
}))
vi.mock('@/lib/ai-registry/api-config-catalog', () => ({
  BUILTIN_API_CONFIG_CATALOG: {},
  registerBuiltinApiConfigCatalog: vi.fn(),
}))
vi.mock('@/lib/ai-exec/engine', () => ({
  executeAiTextStep: videoGroupMocks.executeAiTextStep,
}))
vi.mock('@/lib/video-groups/grid-image', () => ({
  composeAndStoreGridReferenceImage: videoGroupMocks.composeAndStoreGridReferenceImage,
}))
vi.mock('@/lib/video-groups/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/video-groups/core')>()
  return actual
})
vi.mock('@/lib/media/service', () => ({
  ensureMediaObjectFromStorageKey: videoGroupMocks.ensureMediaObjectFromStorageKey,
}))
vi.mock('@/lib/ai-registry/selection', () => ({
  composeModelKey: vi.fn((provider: string, modelId: string) => `${provider}::${modelId}`),
  parseModelKeyStrict: vi.fn((modelKey: string) => {
    const separatorIndex = modelKey.indexOf('::')
    if (separatorIndex <= 0 || separatorIndex >= modelKey.length - 2) return null
    return {
      provider: modelKey.slice(0, separatorIndex),
      modelId: modelKey.slice(separatorIndex + 2),
    }
  }),
}))
vi.mock('@/lib/user-api/runtime-config', () => ({
  getProviderConfig: vi.fn(async () => ({ apiKey: 'api-key' })),
}))
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/workers/user-concurrency-gate', () => concurrencyGateMock)

function buildPanel(overrides?: Partial<PanelRow>): PanelRow {
  return {
    id: 'panel-1',
    videoUrl: 'cos/base-video.mp4',
    imageUrl: 'cos/panel-image.png',
    description: 'panel description',
    firstLastFramePrompt: null,
    duration: 5,
    ...(overrides || {}),
  }
}

function buildJob(params: {
  type: TaskJobData['type']
  payload?: Record<string, unknown>
  targetType?: string
  targetId?: string
}): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-1',
      type: params.type,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: params.targetType ?? 'ProjectPanel',
      targetId: params.targetId ?? 'panel-1',
      payload: params.payload ?? {},
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker video processor behavior', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    workerState.processor = null

    prismaMock.projectPanel.findUnique.mockResolvedValue(buildPanel())
    prismaMock.projectPanel.findFirst.mockResolvedValue(buildPanel())
    prismaMock.project.findUnique.mockResolvedValue({
      analysisModel: 'openai::gpt-4.1',
      videoRatio: '9:16',
      artStyle: 'cinematic',
    })
    prismaMock.projectEditScript.findFirst.mockResolvedValue({
      shotsJson: [
        {
          shotNumber: 1,
          durationSec: 2,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'Shot one',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'A',
          sound: 'tone',
        },
        {
          shotNumber: 2,
          durationSec: 3,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'Shot two',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'B',
          sound: 'pulse',
        },
        {
          shotNumber: 3,
          durationSec: 4,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'Shot three',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'C',
          sound: 'rise',
        },
        {
          shotNumber: 4,
          durationSec: 5,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'Shot four',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'D',
          sound: 'release',
        },
      ],
      videoBlocksJson: [
        {
          kind: 'group',
          shotNumbers: [1, 2, 3, 4],
          gridMode: '2x2',
          reason: 'continuous group',
          prompt: 'stored continuous group prompt',
        },
      ],
    })
    prismaMock.projectEditScreenplay.findFirst.mockResolvedValue(null)

    const mod = await import('@/lib/workers/video.worker')
    mod.createVideoWorker()
  })

  it('VIDEO_GROUP: passes storyboard images individually in shot order and writes ProjectVideoGroup output', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.projectPanel.findMany.mockResolvedValueOnce([
      { ...buildPanel({ id: 'panel-1' }), panelNumber: 1, imageMedia: { storageKey: 'images/panel-1.png' } },
      { ...buildPanel({ id: 'panel-2' }), panelNumber: 2, imageMedia: { storageKey: 'images/panel-2.png' } },
      { ...buildPanel({ id: 'panel-3' }), panelNumber: 3, imageMedia: { storageKey: 'images/panel-3.png' } },
      { ...buildPanel({ id: 'panel-4' }), panelNumber: 4, imageMedia: { storageKey: 'images/panel-4.png' } },
    ])
    utilsMock.uploadVideoSourceToCos.mockResolvedValueOnce('group-video/group-1.mp4')

    const result = await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-1',
      payload: {
        videoModel: 'google::veo',
        gridMode: '2x2',
        shotNumbers: [1, 2, 3, 4],
        generationOptions: { resolution: '720p' },
      },
    }))

    expect(result).toEqual(expect.objectContaining({
      groupId: 'group-1',
      videoUrl: '/m/video-public-1',
      videoMediaId: 'video-media-1',
      durationSec: 14,
      shotNumbers: [1, 2, 3, 4],
    }))
    expect(videoGroupMocks.composeAndStoreGridReferenceImage).not.toHaveBeenCalled()
    expect(videoGroupMocks.executeAiTextStep).not.toHaveBeenCalled()
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      modelId: 'google::veo',
      referenceImages: [
        { url: 'images/panel-1.png', role: 'reference', order: 1, source: 'storyboard' },
        { url: 'images/panel-2.png', role: 'reference', order: 2, source: 'storyboard' },
        { url: 'images/panel-3.png', role: 'reference', order: 3, source: 'storyboard' },
        { url: 'images/panel-4.png', role: 'reference', order: 4, source: 'storyboard' },
      ],
      options: expect.objectContaining({
        prompt: 'stored continuous group prompt',
        duration: 14,
        aspectRatio: '9:16',
      }),
    }))
    expect(prismaMock.projectVideoGroup.update).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 'group-1' },
      data: expect.objectContaining({
        status: 'completed',
        videoUrl: '/m/video-public-1',
        videoMediaId: 'video-media-1',
      }),
    }))
    expect(prismaMock.projectVideoGroup.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'group-1' },
      data: expect.objectContaining({
        referenceImageUrl: null,
        referenceImageMediaId: null,
      }),
    }))
  })

  it('VIDEO_GROUP: appends Style Bible block to final generation prompt', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.projectEditScript.findFirst.mockResolvedValueOnce({
      shotsJson: [
        {
          shotNumber: 1,
          durationSec: 2,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'Shot one',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'A',
          sound: 'tone',
        },
        {
          shotNumber: 2,
          durationSec: 3,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'Shot two',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'B',
          sound: 'pulse',
        },
      ],
      videoBlocksJson: [
        {
          kind: 'group',
          shotNumbers: [1, 2],
          gridMode: '2x2',
          reason: 'continuous group',
          prompt: 'stored continuous group prompt',
        },
      ],
      styleBibleJson: buildZenStyleBibleFixture(),
    })
    prismaMock.projectPanel.findMany.mockResolvedValueOnce([
      { ...buildPanel({ id: 'panel-1' }), panelNumber: 1, imageMedia: { storageKey: 'images/panel-1.png' } },
      { ...buildPanel({ id: 'panel-2' }), panelNumber: 2, imageMedia: { storageKey: 'images/panel-2.png' } },
    ])
    utilsMock.uploadVideoSourceToCos.mockResolvedValueOnce('group-video/group-1.mp4')

    await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-1',
      payload: {
        videoModel: 'google::veo',
        gridMode: '2x2',
        shotNumbers: [1, 2],
      },
    }))

    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      options: expect.objectContaining({
        prompt: expect.stringContaining('stored continuous group prompt'),
      }),
    }))
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      options: expect.objectContaining({
        prompt: expect.stringContaining('用途：最终视频生成'),
      }),
    }))
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      options: expect.objectContaining({
        prompt: expect.stringContaining('声音滤镜：低噪、近自然声场、不过度压缩。'),
      }),
    }))
  })

  it('VIDEO_GROUP asset_reference: uses reference assets and skips storyboard grid composition', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.uploadVideoSourceToCos.mockResolvedValueOnce('asset-reference-video/group-asset.mp4')

    const result = await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-asset-1',
      payload: {
        sourceMode: 'asset_reference',
        videoModel: 'ark::seedance',
        shotNumbers: [1, 2],
        prompt: 'asset reference block prompt',
        referenceImageUrls: ['https://example.com/hero.png', 'https://example.com/location.png'],
        generationOptions: { resolution: '720p' },
      },
    }))

    expect(result).toEqual(expect.objectContaining({
      groupId: 'group-asset-1',
      videoUrl: '/m/video-public-1',
      videoMediaId: 'video-media-1',
      durationSec: 5,
      shotNumbers: [1, 2],
      sourceMode: 'asset_reference',
    }))
    expect(videoGroupMocks.composeAndStoreGridReferenceImage).not.toHaveBeenCalled()
    expect(prismaMock.projectPanel.findMany).not.toHaveBeenCalled()
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      modelId: 'ark::seedance',
      referenceImages: [
        { url: 'https://example.com/hero.png', role: 'reference', order: 1, source: 'asset' },
        { url: 'https://example.com/location.png', role: 'reference', order: 2, source: 'asset' },
      ],
      options: expect.objectContaining({
        prompt: expect.stringContaining('asset reference block prompt'),
        duration: 5,
        aspectRatio: '9:16',
      }),
    }))
    expect(prismaMock.projectVideoGroup.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'group-asset-1' },
      data: expect.objectContaining({
        status: 'processing',
        referenceImageUrl: 'https://example.com/hero.png',
        referenceImageMediaId: null,
      }),
    }))
  })

  it('VIDEO_GROUP asset_reference: appends Style Bible block inside asset-reference prompt', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.projectEditScript.findFirst.mockResolvedValueOnce({
      shotsJson: [
        {
          shotNumber: 1,
          durationSec: 2,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'Shot one',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'A',
          sound: 'tone',
        },
        {
          shotNumber: 2,
          durationSec: 3,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'Shot two',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'B',
          sound: 'pulse',
        },
      ],
      videoBlocksJson: [],
      styleBibleJson: buildZenStyleBibleFixture(),
    })
    utilsMock.uploadVideoSourceToCos.mockResolvedValueOnce('asset-reference-video/group-asset.mp4')

    await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-asset-1',
      payload: {
        sourceMode: 'asset_reference',
        videoModel: 'ark::seedance',
        shotNumbers: [1, 2],
        prompt: 'asset reference block prompt',
        referenceImageUrls: ['https://example.com/hero.png'],
      },
    }))

    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      options: expect.objectContaining({
        prompt: expect.stringContaining('Use the provided reference asset image(s) as fixed visual references'),
      }),
    }))
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      options: expect.objectContaining({
        prompt: expect.stringContaining('asset reference block prompt'),
      }),
    }))
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      options: expect.objectContaining({
        prompt: expect.stringContaining('用途：最终视频生成'),
      }),
    }))
  })

  it('VIDEO_GROUP asset_reference: allows Fal Seedance 2.0 multi-reference assets', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.uploadVideoSourceToCos.mockResolvedValueOnce('asset-reference-video/group-seedance.mp4')

    const result = await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-seedance-1',
      payload: {
        sourceMode: 'asset_reference',
        videoModel: 'fal::bytedance/seedance-2.0',
        shotNumbers: [1, 2],
        prompt: 'seedance asset reference block prompt',
        referenceImageUrls: ['https://example.com/hero.png', 'https://example.com/location.png'],
        generationOptions: { resolution: '720p' },
      },
    }))

    expect(result).toEqual(expect.objectContaining({
      groupId: 'group-seedance-1',
      videoUrl: '/m/video-public-1',
      videoMediaId: 'video-media-1',
      durationSec: 5,
      shotNumbers: [1, 2],
      sourceMode: 'asset_reference',
    }))
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      modelId: 'fal::bytedance/seedance-2.0',
      referenceImages: [
        { url: 'https://example.com/hero.png', role: 'reference', order: 1, source: 'asset' },
        { url: 'https://example.com/location.png', role: 'reference', order: 2, source: 'asset' },
      ],
      options: expect.objectContaining({
        prompt: expect.stringContaining('seedance asset reference block prompt'),
        duration: 5,
        aspectRatio: '9:16',
      }),
    }))
  })

  it('VIDEO_GROUP asset_reference: allows Fal Happy Horse multi-reference assets', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.uploadVideoSourceToCos.mockResolvedValueOnce('asset-reference-video/group-happy-horse.mp4')

    const result = await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-happy-horse-1',
      payload: {
        sourceMode: 'asset_reference',
        videoModel: 'fal::alibaba/happy-horse/image-to-video',
        shotNumbers: [1, 2],
        prompt: 'happy horse asset reference block prompt',
        referenceImageUrls: ['https://example.com/hero.png', 'https://example.com/location.png'],
        generationOptions: { resolution: '720p' },
      },
    }))

    expect(result).toEqual(expect.objectContaining({
      groupId: 'group-happy-horse-1',
      videoUrl: '/m/video-public-1',
      videoMediaId: 'video-media-1',
      durationSec: 5,
      shotNumbers: [1, 2],
      sourceMode: 'asset_reference',
    }))
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      modelId: 'fal::alibaba/happy-horse/image-to-video',
      referenceImages: [
        { url: 'https://example.com/hero.png', role: 'reference', order: 1, source: 'asset' },
        { url: 'https://example.com/location.png', role: 'reference', order: 2, source: 'asset' },
      ],
      options: expect.objectContaining({
        prompt: expect.stringContaining('happy horse asset reference block prompt'),
        duration: 5,
        aspectRatio: '9:16',
      }),
    }))
  })

  it('VIDEO_GROUP asset_reference: allows Fal Seedance 2.0 Fast multi-reference assets', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.uploadVideoSourceToCos.mockResolvedValueOnce('asset-reference-video/group-seedance-fast.mp4')

    const result = await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-seedance-fast-1',
      payload: {
        sourceMode: 'asset_reference',
        videoModel: 'fal::bytedance/seedance-2.0/fast',
        shotNumbers: [1, 2],
        prompt: 'seedance fast asset reference block prompt',
        referenceImageUrls: ['https://example.com/hero.png', 'https://example.com/location.png'],
        generationOptions: { resolution: '720p' },
      },
    }))

    expect(result).toEqual(expect.objectContaining({
      groupId: 'group-seedance-fast-1',
      videoUrl: '/m/video-public-1',
      videoMediaId: 'video-media-1',
      durationSec: 5,
      shotNumbers: [1, 2],
      sourceMode: 'asset_reference',
    }))
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      modelId: 'fal::bytedance/seedance-2.0/fast',
      referenceImages: [
        { url: 'https://example.com/hero.png', role: 'reference', order: 1, source: 'asset' },
        { url: 'https://example.com/location.png', role: 'reference', order: 2, source: 'asset' },
      ],
      options: expect.objectContaining({
        prompt: expect.stringContaining('seedance fast asset reference block prompt'),
        duration: 5,
        aspectRatio: '9:16',
      }),
    }))
  })

  it('VIDEO_GROUP asset_reference: allows Fal Kling v3 multi-reference assets', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.uploadVideoSourceToCos.mockResolvedValueOnce('asset-reference-video/group-kling-v3.mp4')

    const result = await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-kling-v3-1',
      payload: {
        sourceMode: 'asset_reference',
        videoModel: 'fal::fal-ai/kling-video/v3/pro/image-to-video',
        shotNumbers: [1, 2],
        prompt: 'kling v3 asset reference block prompt',
        referenceImageUrls: ['https://example.com/hero.png', 'https://example.com/location.png'],
        generationOptions: {},
      },
    }))

    expect(result).toEqual(expect.objectContaining({
      groupId: 'group-kling-v3-1',
      videoUrl: '/m/video-public-1',
      videoMediaId: 'video-media-1',
      durationSec: 5,
      shotNumbers: [1, 2],
      sourceMode: 'asset_reference',
    }))
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      modelId: 'fal::fal-ai/kling-video/v3/pro/image-to-video',
      referenceImages: [
        { url: 'https://example.com/hero.png', role: 'reference', order: 1, source: 'asset' },
        { url: 'https://example.com/location.png', role: 'reference', order: 2, source: 'asset' },
      ],
      options: expect.objectContaining({
        prompt: expect.stringContaining('kling v3 asset reference block prompt'),
        duration: 5,
        aspectRatio: '9:16',
      }),
    }))
  })

  it('VIDEO_GROUP asset_reference: allows Fal Kling O3 two-frame reference assets', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.uploadVideoSourceToCos.mockResolvedValueOnce('asset-reference-video/group-kling-o3.mp4')

    const result = await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-kling-o3-1',
      payload: {
        sourceMode: 'asset_reference',
        videoModel: 'fal::fal-ai/kling-video/o3/standard/image-to-video',
        shotNumbers: [1, 2],
        prompt: 'kling o3 two-frame block prompt',
        referenceImageUrls: ['https://example.com/start.png', 'https://example.com/end.png'],
        generationOptions: {},
      },
    }))

    expect(result).toEqual(expect.objectContaining({
      groupId: 'group-kling-o3-1',
      videoUrl: '/m/video-public-1',
      videoMediaId: 'video-media-1',
      durationSec: 5,
      shotNumbers: [1, 2],
      sourceMode: 'asset_reference',
    }))
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      modelId: 'fal::fal-ai/kling-video/o3/standard/image-to-video',
      referenceImages: [
        { url: 'https://example.com/start.png', role: 'reference', order: 1, source: 'asset' },
        { url: 'https://example.com/end.png', role: 'reference', order: 2, source: 'asset' },
      ],
      options: expect.objectContaining({
        prompt: expect.stringContaining('kling o3 two-frame block prompt'),
        duration: 5,
        aspectRatio: '9:16',
      }),
    }))
  })

  it('VIDEO_GROUP: fails explicitly when the edit-first video block has no stored prompt', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.projectEditScript.findFirst.mockResolvedValueOnce({
      shotsJson: [
        {
          shotNumber: 1,
          durationSec: 2,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'Shot one',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'A',
          sound: 'tone',
        },
        {
          shotNumber: 2,
          durationSec: 3,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'Shot two',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'B',
          sound: 'pulse',
        },
      ],
      videoBlocksJson: [
        {
          kind: 'group',
          shotNumbers: [1, 2],
          gridMode: '2x2',
          reason: 'continuous group',
        },
      ],
    })
    prismaMock.projectPanel.findMany.mockResolvedValueOnce([
      { ...buildPanel({ id: 'panel-1' }), panelNumber: 1, imageMedia: { storageKey: 'images/panel-1.png' } },
      { ...buildPanel({ id: 'panel-2' }), panelNumber: 2, imageMedia: { storageKey: 'images/panel-2.png' } },
    ])

    await expect(processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-1',
      payload: {
        videoModel: 'google::veo',
        gridMode: '2x2',
        shotNumbers: [1, 2],
      },
    }))).rejects.toThrow('VIDEO_GROUP_PROMPT_REQUIRED:1,2')

    expect(videoGroupMocks.executeAiTextStep).not.toHaveBeenCalled()
    expect(utilsMock.resolveVideoSourceFromGeneration).not.toHaveBeenCalled()
  })

  it('VIDEO_PANEL: 缺少 payload.videoModel 时显式失败', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {},
    })

    await expect(processor!(job)).rejects.toThrow('VIDEO_MODEL_REQUIRED: payload.videoModel is required')
  })

  it('VIDEO_PANEL: 透传异步轮询返回的下载头到 COS 上传', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.resolveVideoSourceFromGeneration.mockResolvedValueOnce({
      url: 'https://provider.example/video.mp4',
      downloadHeaders: {
        Authorization: 'Bearer oa-key',
      },
    })

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'fal::veo3/fast',
        generationOptions: {
          duration: 8,
          resolution: '720p',
        },
      },
    })

    await processor!(job)

    expect(utilsMock.uploadVideoSourceToCos).toHaveBeenCalledWith(
      'https://provider.example/video.mp4',
      'panel-video',
      'panel-1',
      {
        Authorization: 'Bearer oa-key',
      },
    )
  })

  it('VIDEO_PANEL: appends Style Bible block to final panel video prompt', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.projectEditScript.findFirst.mockResolvedValueOnce({
      styleBibleJson: buildZenStyleBibleFixture(),
    })

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'ark::doubao-seedance-2-0-260128',
        generationOptions: {
          duration: 5,
          resolution: '720p',
        },
      },
    })

    await processor!(job)

    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        options: expect.objectContaining({
          prompt: expect.stringContaining('panel description'),
        }),
      }),
    )
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        options: expect.objectContaining({
          prompt: expect.stringContaining('用途：最终视频生成'),
        }),
      }),
    )
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        options: expect.objectContaining({
          prompt: expect.stringContaining('声音滤镜：低噪、近自然声场、不过度压缩。'),
        }),
      }),
    )
  })

  it('VIDEO_PANEL: 将 Ark 返回的实际视频 token 用量透传到任务结果', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.resolveVideoSourceFromGeneration.mockResolvedValueOnce({
      url: 'https://provider.example/video.mp4',
      actualVideoTokens: 108000,
    })

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'ark::doubao-seedance-2-0-260128',
        generationOptions: {
          duration: 5,
          resolution: '720p',
        },
      },
    })

    const result = await processor!(job) as { panelId: string; videoUrl: string; actualVideoTokens: number }
    expect(result).toEqual({
      panelId: 'panel-1',
      videoUrl: 'cos/video/video.mp4',
      actualVideoTokens: 108000,
    })
  })

  it('VIDEO_PANEL: 成功生成后保存本次实际使用的 generationOptions', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'ark::doubao-seedance-2-0-260128',
        generationOptions: {
          duration: 8,
          resolution: '720p',
          generateAudio: true,
          aspectRatio: '9:16',
        },
      },
    })

    await processor!(job)

    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        options: expect.objectContaining({
          aspectRatio: '16:9',
          duration: 5,
          resolution: '720p',
          generateAudio: true,
          generationMode: 'normal',
        }),
      }),
    )
    expect(prismaMock.projectPanel.update).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: {
        videoUrl: 'cos/video/video.mp4',
        videoGenerationMode: 'normal',
        lastVideoGenerationOptions: {
          resolution: '720p',
          generateAudio: true,
        },
      },
    })
  })

  it('VIDEO_PANEL: 缺少系统镜头时长时显式失败', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.projectPanel.findUnique.mockResolvedValueOnce(buildPanel({ duration: null }))
    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'ark::doubao-seedance-2-0-260128',
        generationOptions: {
          duration: 8,
          resolution: '720p',
        },
      },
    })

    await expect(processor!(job)).rejects.toThrow('VIDEO_PANEL_DURATION_REQUIRED:panel-1')
  })

  it('未知任务类型: 显式报错', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const unsupportedJob = buildJob({
      type: TASK_TYPE.AI_CREATE_CHARACTER,
    })

    await expect(processor!(unsupportedJob)).rejects.toThrow('Unsupported video task type')
  })
})
