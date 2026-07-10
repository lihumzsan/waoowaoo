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

export type { Job } from 'bullmq'
export { beforeEach, describe, expect, it, vi } from 'vitest'
export type { EditGenerationSegment, EditGenerationSegmentExecution, EditScriptShot, EditShotExecution } from '@/lib/edit-script/types'
export type { StoryboardConsistencySourceSnapshot } from '@/lib/edit-script/storyboard-consistency/types'
export { TASK_TYPE } from '@/lib/task/types'
export type { TaskJobData } from '@/lib/task/types'
export { buildZenStyleBibleFixture } from '../../fixtures/edit-script-style-bible'
export { buildCorePlan, buildExecutionShot, buildGenerationSegmentExecution, buildJob, buildPanel, buildStoryboardSourceResult, concurrencyGateMock, configServiceMock, prismaMock, reportTaskProgressMock, storyboardSourceMock, utilsMock, videoGroupMocks, withTaskLifecycleMock, workerState }
export type { PanelRow, WorkerProcessor }
