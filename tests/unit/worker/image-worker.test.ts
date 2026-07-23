import { UnrecoverableError, type Job } from 'bullmq'
import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CODEX_DEFAULT_IMAGE_MODEL_KEY } from '@/lib/providers/codex/constants'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

type WorkerProcessor = (job: Job<TaskJobData>) => Promise<unknown>

const workerState = vi.hoisted(() => ({
  processor: null as WorkerProcessor | null,
}))

const handlerMock = vi.hoisted(() => ({
  handleAssetHubImageTask: vi.fn(async () => ({ ok: true })),
  handleAssetHubModifyTask: vi.fn(async () => ({ ok: true })),
  handleCharacterImageTask: vi.fn(async () => ({ ok: true })),
  handleEpisodeCoverImageTask: vi.fn(async (job: Job<TaskJobData>) => {
    void job
    return {
      episodeId: 'episode-1',
      coverImageMediaId: 'media-cover-1',
      coverImageUrl: '/m/cover-1',
    }
  }),
  handleLocationImageTask: vi.fn(async () => ({ ok: true })),
  handleModifyAssetImageTask: vi.fn(async () => ({ ok: true })),
  handlePanelImageTask: vi.fn(async () => ({ ok: true })),
  handlePanelVariantTask: vi.fn(async () => ({ ok: true })),
}))

const configServiceMock = vi.hoisted(() => ({
  getUserWorkflowConcurrencyConfig: vi.fn(async () => ({
    analysis: 5,
    image: 5,
    video: 5,
  })),
}))

const gateMock = vi.hoisted(() => ({
  withUserConcurrencyGate: vi.fn(async <T>(input: {
    run: () => Promise<T>
  }) => await input.run()),
}))

const executeAiVisionStepMock = vi.hoisted(() => vi.fn())

const taskServiceMock = vi.hoisted(() => ({
  touchTaskHeartbeat: vi.fn(async () => undefined),
  tryMarkTaskCompleted: vi.fn(async () => true),
  tryMarkTaskFailed: vi.fn(async () => true),
  tryMarkTaskProcessing: vi.fn(async () => true),
  tryMarkTaskQueuedForRetry: vi.fn(async () => true),
  tryUpdateTaskProgress: vi.fn(async () => true),
}))

const publisherMock = vi.hoisted(() => ({
  publishTaskEvent: vi.fn(async () => ({})),
  publishTaskStreamEvent: vi.fn(async () => ({})),
}))

const workerUtilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getProjectModels: vi.fn(async () => ({ videoRatio: '16:9', artStyle: 'realistic' })),
  resolveImageSourceFromGeneration: vi.fn(),
  resolveVideoSourceFromGeneration: vi.fn(),
  uploadImageSourceToCosWithMetadata: vi.fn(),
}))

const prismaMock = vi.hoisted(() => ({
  project: { findUnique: vi.fn(async () => null) },
  novelPromotionEpisode: {
    findFirst: vi.fn(async () => ({
      id: 'episode-1',
      description: 'A hero returns to the old town.',
      novelText: 'Rain falls over the clock tower.',
      clips: [],
      storyboards: [{ panels: [] }],
    })),
    update: vi.fn(),
  },
}))

vi.mock('bullmq', () => ({
  UnrecoverableError: class UnrecoverableError extends Error {},
  Queue: class {
    constructor() {}

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
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/workers/user-concurrency-gate', () => gateMock)
vi.mock('@/lib/workers/handlers/image-task-handlers', () => handlerMock)
vi.mock('@/lib/ai-runtime/client', () => ({ executeAiVisionStep: executeAiVisionStepMock }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))
vi.mock('@/lib/task/service', () => taskServiceMock)
vi.mock('@/lib/task/publisher', () => publisherMock)
vi.mock('@/lib/task/progress-message', () => ({
  buildTaskProgressMessage: vi.fn(() => 'progress-message'),
  getTaskStageLabel: vi.fn((stage: string) => `label:${stage}`),
}))
vi.mock('@/lib/logging/file-writer', () => ({ onProjectNameAvailable: vi.fn() }))
vi.mock('@/lib/run-runtime/task-bridge', () => ({ mapTaskSSEEventToRunEvents: vi.fn(() => []) }))
vi.mock('@/lib/run-runtime/publisher', () => ({ publishRunEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/workers/utils', () => workerUtilsMock)
vi.mock('@/lib/constants', () => ({ getArtStylePrompt: vi.fn(() => 'realistic style') }))
vi.mock('@/lib/media/outbound-image', () => ({
  normalizeReferenceImagesForGeneration: vi.fn(async (references: string[]) => references),
}))
vi.mock('@/lib/media/service', () => ({ ensureMediaObjectFromStorageKey: vi.fn() }))
vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: { NP_EPISODE_COVER_IMAGE: 'np_episode_cover_image' },
  buildPrompt: vi.fn(() => 'episode cover prompt'),
}))
vi.mock('@/lib/workers/handlers/image-task-handler-shared', () => ({
  resolveNovelData: vi.fn(async () => ({
    videoRatio: '16:9',
    characters: [],
    locations: [],
  })),
  collectPanelReferenceImages: vi.fn(async () => []),
}))

import { handleEpisodeCoverImageTask } from '@/lib/workers/handlers/episode-cover-image-task-handler'

function buildJob(type: TaskJobData['type']): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-image-1',
      type,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionPanel',
      targetId: 'panel-1',
      payload: {},
      userId: 'user-1',
    },
    queueName: 'waoowaoo-image',
    opts: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 2_000 },
    },
    attemptsMade: 0,
  } as unknown as Job<TaskJobData>
}

describe('worker image concurrency behavior', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    workerState.processor = null
    handlerMock.handleEpisodeCoverImageTask.mockResolvedValue({
      episodeId: 'episode-1',
      coverImageMediaId: 'media-cover-1',
      coverImageUrl: '/m/cover-1',
    })
    executeAiVisionStepMock.mockResolvedValue({
      text: JSON.stringify({
        hasReadableText: false,
        hasEpisodeNumber: false,
        hasLogo: false,
        hasWatermark: false,
        isCollage: false,
        isSingleContinuousScene: true,
        issues: [],
      }),
      reasoning: '',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      completion: {},
    })

    const mod = await import('@/lib/workers/image.worker')
    mod.createImageWorker()
  })

  it('reads user image concurrency and applies gate before processing', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const job = buildJob(TASK_TYPE.IMAGE_PANEL)
    await processor!(job)

    expect(configServiceMock.getUserWorkflowConcurrencyConfig).toHaveBeenCalledWith('user-1')
    expect(gateMock.withUserConcurrencyGate).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'image',
      userId: 'user-1',
      limit: 5,
    }))
    expect(handlerMock.handlePanelImageTask).toHaveBeenCalledWith(job)
  })

  it('routes Episode cover image jobs to the dedicated image handler', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const job = buildJob('image_episode_cover' as TaskJobData['type'])
    await processor!(job)

    expect(handlerMock.handleEpisodeCoverImageTask).toHaveBeenCalledWith(job)
  })

  it.each([
    ['truncated PNG', async () => {
      const source = await sharp({
        create: {
          width: 1600,
          height: 900,
          channels: 3,
          background: { r: 24, g: 48, b: 72 },
        },
      }).png().toBuffer()
      const truncated = source.subarray(0, Math.floor(source.byteLength / 2))
      await expect(sharp(truncated).metadata()).resolves.toMatchObject({
        format: 'png',
        width: 1600,
        height: 900,
      })
      return `data:image/png;base64,${truncated.toString('base64')}`
    }],
    ['empty Buffer', async () => Buffer.alloc(0)],
  ] as const)(
    'requeues the first %s audit failure and routes the second attempt to the same Episode cover handler',
    async (_label, buildSource) => {
      workerUtilsMock.resolveImageSourceFromGeneration.mockResolvedValue(
        await buildSource(),
      )
      handlerMock.handleEpisodeCoverImageTask.mockImplementation(handleEpisodeCoverImageTask)
      const processor = workerState.processor
      expect(processor).toBeTruthy()
      const job = buildJob(TASK_TYPE.IMAGE_EPISODE_COVER)

      const firstError = await processor!(job).catch((error) => error)

      expect(firstError).toMatchObject({ code: 'GENERATION_FAILED' })
      expect(firstError).not.toBeInstanceOf(UnrecoverableError)
      expect(taskServiceMock.tryMarkTaskQueuedForRetry).toHaveBeenCalledTimes(1)
      expect(taskServiceMock.tryMarkTaskFailed).not.toHaveBeenCalled()
      expect(handlerMock.handleEpisodeCoverImageTask).toHaveBeenCalledTimes(1)

      ;(job as Job<TaskJobData> & { attemptsMade: number }).attemptsMade = 1
      await expect(processor!(job)).rejects.toBeInstanceOf(UnrecoverableError)

      expect(handlerMock.handleEpisodeCoverImageTask).toHaveBeenCalledTimes(2)
      expect(workerUtilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledTimes(2)
      expect(workerUtilsMock.resolveImageSourceFromGeneration).toHaveBeenNthCalledWith(
        1,
        job,
        expect.objectContaining({ modelId: CODEX_DEFAULT_IMAGE_MODEL_KEY }),
      )
      expect(workerUtilsMock.resolveImageSourceFromGeneration).toHaveBeenNthCalledWith(
        2,
        job,
        expect.objectContaining({ modelId: CODEX_DEFAULT_IMAGE_MODEL_KEY }),
      )
      expect(workerUtilsMock.resolveVideoSourceFromGeneration).not.toHaveBeenCalled()
      expect(executeAiVisionStepMock).not.toHaveBeenCalled()
      expect(workerUtilsMock.uploadImageSourceToCosWithMetadata).not.toHaveBeenCalled()
      expect(prismaMock.novelPromotionEpisode.update).not.toHaveBeenCalled()
      expect(taskServiceMock.tryMarkTaskFailed).toHaveBeenCalledTimes(1)
      expect(handlerMock.handlePanelImageTask).not.toHaveBeenCalled()
      expect(handlerMock.handleCharacterImageTask).not.toHaveBeenCalled()
      expect(handlerMock.handleLocationImageTask).not.toHaveBeenCalled()
    },
  )
})
