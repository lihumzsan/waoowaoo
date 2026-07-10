import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditGenerationSegment, EditGenerationSegmentExecution, EditScriptShot, EditShotExecution } from '@/lib/edit-script/types'
import type { StoryboardConsistencySourceSnapshot } from '@/lib/edit-script/storyboard-consistency/types'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { buildZenStyleBibleFixture } from '../../fixtures/edit-script-style-bible'

type WorkerProcessor = (job: Job<TaskJobData>) => Promise<unknown>

type PanelRow = {
  id: string
  videoUrl: string | null
  imageUrl: string | null
  description: string | null
  videoPrompt: string | null
  duration: number | null
  sourceShotId: string | null
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
const storyboardSourceMock = vi.hoisted(() => ({
  buildStoryboardConsistencySource: vi.fn(),
}))

const prismaMock = vi.hoisted(() => ({
  projectPanel: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(async () => undefined),
  },
  projectVideoGroup: {
    findUnique: vi.fn(),
    update: vi.fn(async () => undefined),
  },
  project: {
    findUnique: vi.fn(),
  },
  projectEditScript: {
    findFirst: vi.fn(),
  },
  projectEditBible: {
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
vi.mock('@/lib/ai-registry/capabilities-catalog', () => {
  const multiReferenceVideoModelKeys = new Set([
    'ark::doubao-seedance-2-0-260128',
    'fal::bytedance/seedance-2.0',
    'fal::bytedance/seedance-2.0/fast',
    'fal::alibaba/happy-horse/image-to-video',
    'fal::fal-ai/kling-video/o3/standard/image-to-video',
    'fal::fal-ai/kling-video/v3/pro/image-to-video',
  ])
  return {
    registerBuiltinCapabilityCatalogEntries: vi.fn(),
    resolveBuiltinCapabilitiesByModelKey: vi.fn((_modelType: string, modelKey: string) => ({
      video: {
        firstlastframe: true,
        assetReferenceMultiReference: multiReferenceVideoModelKeys.has(modelKey),
      },
    })),
  }
})
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
vi.mock('@/lib/edit-script/storyboard-consistency/source-snapshot', () => ({
  buildStoryboardConsistencySource: storyboardSourceMock.buildStoryboardConsistencySource,
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
    videoPrompt: 'panel video prompt',
    duration: 5,
    sourceShotId: 'shot-1',
    ...(overrides || {}),
  }
}

function buildCorePlan(
  shots: readonly {
    readonly shotId?: string
    readonly shotNumber: number
    readonly durationSec: number
    readonly action: string
    readonly sound: string
    readonly dialogue?: readonly { readonly characterId: string; readonly line: string }[]
  }[] = [
    { shotId: 'shot-1', shotNumber: 1, durationSec: 2, action: 'Shot one', sound: 'tone' },
    { shotId: 'shot-2', shotNumber: 2, durationSec: 3, action: 'Shot two', sound: 'pulse' },
    { shotId: 'shot-3', shotNumber: 3, durationSec: 4, action: 'Shot three', sound: 'rise' },
    { shotId: 'shot-4', shotNumber: 4, durationSec: 5, action: 'Shot four', sound: 'release' },
  ],
  generationSegments: readonly EditGenerationSegment[] = [
    { shotIds: shots.map((shot) => shot.shotId ?? `shot-${shot.shotNumber}`), continuity: 'continuous group' },
  ],
): { readonly shots: readonly EditScriptShot[]; readonly generationSegments: readonly EditGenerationSegment[] } {
  return {
    shots: shots.map((shot) => ({
      shotId: shot.shotId ?? `shot-${shot.shotNumber}`,
      shotNumber: shot.shotNumber,
      shotPurpose: 'action' as const,
      durationSec: shot.durationSec,
      scene: { locationId: 'location-1', name: 'Test Room', subScene: 'Test Room' },
      action: shot.action,
      characters: [
        {
          characterId: 'character-1',
          name: 'Hero',
          visibility: 'visible',
          role: 'focus',
          performance: `Performs ${shot.action}`,
        },
      ],
      keyObjects: [
        { name: 'Chair', role: 'blocking_anchor' },
      ],
      dialogue: shot.dialogue ?? [],
      sound: shot.sound,
    })),
    generationSegments,
  }
}

function buildExecutionShot(shot: EditScriptShot): EditShotExecution {
  return {
    shotId: shot.shotId,
    shotNumber: shot.shotNumber,
    camera: {
      shotScale: '中景',
      lens: '35mm',
      focus: 'Hero and anchor object remain clear',
      height: '视线高度',
      angle: '平视',
      movement: '固定机位',
      composition: 'Hero and chair preserve screen relation',
      lighting: 'soft directional light preserves continuity',
    },
    blocking: {
      axis: {
        type: 'subject_line',
        subjects: ['Hero', 'Chair'],
        screenDirection: 'Hero remains screen left of Chair',
      },
      characters: [
        {
          name: 'Hero',
          visibility: 'visible',
          position: 'beside the chair',
          screenPosition: 'screen left',
          facing: 'toward the chair',
          eyeline: 'toward the chair',
        },
      ],
      objects: [
        {
          name: 'Chair',
          position: 'center of the room',
          screenPosition: 'screen center',
        },
      ],
      spatialNote: 'Hero and chair preserve the same axis across shots',
    },
    videoPrompt: `Single-shot video prompt for shot ${shot.shotNumber}: Hero remains screen left of Chair, preserve the same room tone and camera movement.`,
  }
}

function buildGenerationSegmentExecution(segment: EditGenerationSegment): EditGenerationSegmentExecution {
  return {
    shotIds: segment.shotIds,
    continuousVideoPrompt: 'Stored continuous segment prompt from ShotExecutionPlan. [00:00-00:02] Shot 1: Hero and chair hold the same screen direction. <room tone continues>',
  }
}

function buildStoryboardSourceResult(
  corePlan: { readonly shots: readonly EditScriptShot[]; readonly generationSegments: readonly EditGenerationSegment[] } = buildCorePlan(),
): {
  readonly sourceSnapshot: StoryboardConsistencySourceSnapshot
  readonly modelConfigSnapshot: { readonly analysisModel: string; readonly storyboardModel: string }
} {
  return {
    modelConfigSnapshot: {
      analysisModel: 'openai::gpt-4.1',
      storyboardModel: 'google::imagen',
    },
    sourceSnapshot: {
      projectId: 'project-1',
      episodeId: 'episode-1',
      chapterId: 'chapter-1',
      project: { videoRatio: '9:16' },
      editScript: {
        id: 'edit-script-1',
        durationSec: corePlan.shots.reduce((total, shot) => total + shot.durationSec, 0),
        shotCount: corePlan.shots.length,
        sourceText: 'test bible',
      },
      styleBible: buildZenStyleBibleFixture(),
      shots: corePlan.shots,
      shotExecutionPlan: {
        shots: corePlan.shots.map((shot) => buildExecutionShot(shot)),
        generationSegmentExecutions: corePlan.generationSegments.map((segment) => buildGenerationSegmentExecution(segment)),
      },
      generationSegments: corePlan.generationSegments.map((segment, index) => ({
        ...segment,
        segmentIndex: index,
        sourceGenerationSegmentId: `edit-script-1:generationSegment:${index + 1}`,
      })),
      assets: [
        {
          requirementId: 'asset-character-hero',
          kind: 'character',
          name: 'Hero',
          description: 'Hero reference',
          shotIds: corePlan.shots.map((shot) => shot.shotId),
          targetId: 'character-hero',
          previewImageUrl: 'https://example.com/hero.png',
        },
        {
          requirementId: 'asset-location-room',
          kind: 'location',
          name: 'Test Room',
          description: 'Room reference',
          shotIds: corePlan.shots.map((shot) => shot.shotId),
          targetId: 'location-room',
          previewImageUrl: 'https://example.com/room.png',
          spatialProfile: null,
        },
      ],
    },
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
    const defaultCorePlan = buildCorePlan()
    prismaMock.projectEditScript.findFirst.mockResolvedValue({
      id: 'edit-script-1',
      corePlanJson: defaultCorePlan,
    })
    prismaMock.projectVideoGroup.findUnique.mockResolvedValue({
      prompt: 'composed video group prompt',
    })
    prismaMock.projectEditBible.findFirst.mockResolvedValue(null)
    storyboardSourceMock.buildStoryboardConsistencySource.mockResolvedValue(buildStoryboardSourceResult(defaultCorePlan))

    const mod = await import('@/lib/workers/video.worker')
    mod.createVideoWorker()
  })

  it('VIDEO_GROUP: passes storyboard images individually in shot order and writes ProjectVideoGroup output', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.projectPanel.findMany.mockResolvedValueOnce([
      { ...buildPanel({ id: 'panel-1', sourceShotId: 'shot-1' }), panelNumber: 1, imageMedia: { storageKey: 'images/panel-1.png' } },
      { ...buildPanel({ id: 'panel-2', sourceShotId: 'shot-2' }), panelNumber: 2, imageMedia: { storageKey: 'images/panel-2.png' } },
      { ...buildPanel({ id: 'panel-3', sourceShotId: 'shot-3' }), panelNumber: 3, imageMedia: { storageKey: 'images/panel-3.png' } },
      { ...buildPanel({ id: 'panel-4', sourceShotId: 'shot-4' }), panelNumber: 4, imageMedia: { storageKey: 'images/panel-4.png' } },
    ])
    utilsMock.uploadVideoSourceToCos.mockResolvedValueOnce('group-video/group-1.mp4')

    const result = await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-1',
      payload: {
        videoModel: 'google::veo',
        gridMode: '2x2',
        chapterId: 'chapter-1',
        shotIds: ['shot-1', 'shot-2', 'shot-3', 'shot-4'],
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
        prompt: 'composed video group prompt',
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

  it('VIDEO_GROUP: fails when ProjectVideoGroup.prompt is missing', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.projectVideoGroup.findUnique.mockResolvedValueOnce({ prompt: null })

    await expect(processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-1',
      payload: {
        videoModel: 'google::veo',
        gridMode: '2x2',
        chapterId: 'chapter-1',
        shotIds: ['shot-1', 'shot-2'],
      },
    }))).rejects.toThrow('VIDEO_GROUP_PROMPT_MISSING:group-1')

    expect(utilsMock.resolveVideoSourceFromGeneration).not.toHaveBeenCalled()
  })

  it('VIDEO_GROUP asset_reference: uses reference assets and skips storyboard grid composition', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.uploadVideoSourceToCos.mockResolvedValueOnce('asset-reference-video/group-asset.mp4')
    prismaMock.projectVideoGroup.findUnique.mockResolvedValueOnce({
      prompt: 'asset reference block prompt',
    })

    const result = await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-asset-1',
      payload: {
        sourceMode: 'asset_reference',
        videoModel: 'ark::doubao-seedance-2-0-260128',
        episodeId: 'episode-1',
        chapterId: 'chapter-1',
        shotIds: ['shot-1', 'shot-2'],
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
      modelId: 'ark::doubao-seedance-2-0-260128',
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

  it('VIDEO_GROUP asset_reference: uses stored group prompt without building a source prompt', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const twoShotCorePlan = buildCorePlan([
      { shotNumber: 1, durationSec: 2, action: 'Shot one', sound: 'tone' },
      { shotNumber: 2, durationSec: 3, action: 'Shot two', sound: 'pulse' },
    ])
    prismaMock.projectEditScript.findFirst.mockResolvedValueOnce({
      id: 'edit-script-1',
      corePlanJson: twoShotCorePlan,
    })
    utilsMock.uploadVideoSourceToCos.mockResolvedValueOnce('asset-reference-video/group-asset.mp4')
    prismaMock.projectVideoGroup.findUnique.mockResolvedValueOnce({
      prompt: 'stored asset reference block prompt',
    })

    await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-asset-1',
      payload: {
        sourceMode: 'asset_reference',
        videoModel: 'ark::doubao-seedance-2-0-260128',
        episodeId: 'episode-1',
        chapterId: 'chapter-1',
        shotIds: ['shot-1', 'shot-2'],
        prompt: 'ignored payload prompt',
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
        prompt: expect.stringContaining('stored asset reference block prompt'),
      }),
    }))
    expect(storyboardSourceMock.buildStoryboardConsistencySource).not.toHaveBeenCalled()
  })

  it('VIDEO_GROUP asset_reference: allows Fal Seedance 2.0 multi-reference assets', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.uploadVideoSourceToCos.mockResolvedValueOnce('asset-reference-video/group-seedance.mp4')
    prismaMock.projectVideoGroup.findUnique.mockResolvedValueOnce({
      prompt: 'seedance asset reference block prompt',
    })

    const result = await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-seedance-1',
      payload: {
        sourceMode: 'asset_reference',
        videoModel: 'fal::bytedance/seedance-2.0',
        episodeId: 'episode-1',
        chapterId: 'chapter-1',
        shotIds: ['shot-1', 'shot-2'],
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
    prismaMock.projectVideoGroup.findUnique.mockResolvedValueOnce({
      prompt: 'happy horse asset reference block prompt',
    })

    const result = await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-happy-horse-1',
      payload: {
        sourceMode: 'asset_reference',
        videoModel: 'fal::alibaba/happy-horse/image-to-video',
        episodeId: 'episode-1',
        chapterId: 'chapter-1',
        shotIds: ['shot-1', 'shot-2'],
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
    prismaMock.projectVideoGroup.findUnique.mockResolvedValueOnce({
      prompt: 'seedance fast asset reference block prompt',
    })

    const result = await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-seedance-fast-1',
      payload: {
        sourceMode: 'asset_reference',
        videoModel: 'fal::bytedance/seedance-2.0/fast',
        episodeId: 'episode-1',
        chapterId: 'chapter-1',
        shotIds: ['shot-1', 'shot-2'],
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
    prismaMock.projectVideoGroup.findUnique.mockResolvedValueOnce({
      prompt: 'kling v3 asset reference block prompt',
    })

    const result = await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-kling-v3-1',
      payload: {
        sourceMode: 'asset_reference',
        videoModel: 'fal::fal-ai/kling-video/v3/pro/image-to-video',
        episodeId: 'episode-1',
        chapterId: 'chapter-1',
        shotIds: ['shot-1', 'shot-2'],
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
    prismaMock.projectVideoGroup.findUnique.mockResolvedValueOnce({
      prompt: 'kling o3 two-frame block prompt',
    })

    const result = await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-kling-o3-1',
      payload: {
        sourceMode: 'asset_reference',
        videoModel: 'fal::fal-ai/kling-video/o3/standard/image-to-video',
        episodeId: 'episode-1',
        chapterId: 'chapter-1',
        shotIds: ['shot-1', 'shot-2'],
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

  it('VIDEO_GROUP: uses stored prompt without reading generation segment facts', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const twoShotCorePlan = buildCorePlan([
      { shotNumber: 1, durationSec: 2, action: 'Shot one', sound: 'tone' },
      { shotNumber: 2, durationSec: 3, action: 'Shot two', sound: 'pulse' },
    ], [
      { shotIds: ['shot-1'], continuity: 'shot one only' },
      { shotIds: ['shot-2'], continuity: 'shot two only' },
    ])
    prismaMock.projectEditScript.findFirst.mockResolvedValueOnce({
      id: 'edit-script-1',
      corePlanJson: twoShotCorePlan,
    })
    prismaMock.projectPanel.findMany.mockResolvedValueOnce([
      { ...buildPanel({ id: 'panel-1', sourceShotId: 'shot-1' }), panelNumber: 1, imageMedia: { storageKey: 'images/panel-1.png' } },
      { ...buildPanel({ id: 'panel-2', sourceShotId: 'shot-2' }), panelNumber: 2, imageMedia: { storageKey: 'images/panel-2.png' } },
    ])
    prismaMock.projectVideoGroup.findUnique.mockResolvedValueOnce({
      prompt: 'stored segment prompt for unmatched generation segment',
    })
    utilsMock.uploadVideoSourceToCos.mockResolvedValueOnce('group-video/group-1.mp4')

    await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-1',
      payload: {
        videoModel: 'google::veo',
        gridMode: '2x2',
        chapterId: 'chapter-1',
        shotIds: ['shot-1', 'shot-2'],
      },
    }))

    expect(storyboardSourceMock.buildStoryboardConsistencySource).not.toHaveBeenCalled()
    expect(videoGroupMocks.executeAiTextStep).not.toHaveBeenCalled()
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      options: expect.objectContaining({
        prompt: 'stored segment prompt for unmatched generation segment',
      }),
    }))
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

  it('VIDEO_PANEL: uses the persisted panel video prompt', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

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
          prompt: expect.stringContaining('panel video prompt'),
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
