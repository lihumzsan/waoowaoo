import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASKTYPE_BEHAVIOR_MATRIX } from '../../contracts/tasktype-behavior-matrix'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

type AddCall = {
  jobName: string
  data: TaskJobData
  options: Record<string, unknown>
}

type WorkerProcessor = (job: Job<TaskJobData>) => Promise<unknown>

const queueState = vi.hoisted(() => ({
  addCallsByQueue: new Map<string, AddCall[]>(),
}))

const workerState = vi.hoisted(() => ({
  processor: null as WorkerProcessor | null,
}))

const workerSharedMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  withTaskLifecycle: vi.fn(async (job: Job<TaskJobData>, handler: WorkerProcessor) => await handler(job)),
}))

const imageHandlerMock = vi.hoisted(() => ({
  handleAssetHubImageTask: vi.fn(async () => ({ ok: true })),
  handleAssetHubModifyTask: vi.fn(async () => ({ ok: true })),
  handleCharacterImageTask: vi.fn(async () => ({ ok: true })),
  handleEpisodeCoverImageTask: vi.fn(async () => ({ ok: true })),
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
  withUserConcurrencyGate: vi.fn(async <T>(input: { run: () => Promise<T> }) => await input.run()),
}))

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getUserModels: vi.fn(async () => ({
    characterModel: 'model-character-1',
    locationModel: 'model-location-1',
  })),
}))

const prismaMock = vi.hoisted(() => ({
  globalCharacter: {
    findFirst: vi.fn(),
  },
  globalCharacterAppearance: {
    update: vi.fn(async () => ({})),
  },
  globalLocation: {
    findFirst: vi.fn(),
  },
  globalLocationImage: {
    update: vi.fn(async () => ({})),
  },
}))

const sharedMock = vi.hoisted(() => ({
  generateCleanImageToStorage: vi.fn(async () => 'cos/global-character-generated.png'),
  parseJsonStringArray: vi.fn(() => [] as string[]),
}))

vi.mock('bullmq', () => ({
  Queue: class {
    private readonly queueName: string

    constructor(queueName: string) {
      this.queueName = queueName
    }

    async add(jobName: string, data: TaskJobData, options: Record<string, unknown>) {
      const list = queueState.addCallsByQueue.get(this.queueName) || []
      list.push({ jobName, data, options })
      queueState.addCallsByQueue.set(this.queueName, list)
      return { id: data.taskId }
    }

    async getJob() {
      return null
    }
  },
  Worker: class {
    constructor(_name: string, processor: WorkerProcessor) {
      workerState.processor = processor
    }
  },
}))

vi.mock('@/lib/redis', () => ({ queueRedis: {} }))
vi.mock('@/lib/workers/shared', () => workerSharedMock)
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/workers/user-concurrency-gate', () => gateMock)
vi.mock('@/lib/workers/handlers/image-task-handlers', () => imageHandlerMock)
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/handlers/image-task-handler-shared', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workers/handlers/image-task-handler-shared')>(
    '@/lib/workers/handlers/image-task-handler-shared',
  )
  return {
    ...actual,
    generateCleanImageToStorage: sharedMock.generateCleanImageToStorage,
    parseJsonStringArray: sharedMock.parseJsonStringArray,
  }
})

function toJob(data: TaskJobData): Job<TaskJobData> {
  return { data } as unknown as Job<TaskJobData>
}

describe('chain contract - image queue behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queueState.addCallsByQueue.clear()
    workerState.processor = null
  })

  it('image tasks are enqueued into image queue with jobId=taskId', async () => {
    const { addTaskJob, QUEUE_NAME } = await import('@/lib/task/queues')

    await addTaskJob({
      taskId: 'task-image-1',
      type: TASK_TYPE.ASSET_HUB_IMAGE,
      locale: 'zh',
      projectId: 'global-asset-hub',
      episodeId: null,
      targetType: 'GlobalCharacter',
      targetId: 'global-character-1',
      payload: { type: 'character', id: 'global-character-1' },
      userId: 'user-1',
    })

    const calls = queueState.addCallsByQueue.get(QUEUE_NAME.IMAGE) || []
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(expect.objectContaining({
      jobName: TASK_TYPE.ASSET_HUB_IMAGE,
      options: expect.objectContaining({ jobId: 'task-image-1', priority: 0 }),
    }))
  })

  it('modify asset image task also routes to image queue', async () => {
    const { addTaskJob, QUEUE_NAME } = await import('@/lib/task/queues')

    await addTaskJob({
      taskId: 'task-image-2',
      type: TASK_TYPE.MODIFY_ASSET_IMAGE,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'CharacterAppearance',
      targetId: 'appearance-1',
      payload: { appearanceId: 'appearance-1', modifyPrompt: 'make it cleaner' },
      userId: 'user-1',
    })

    const calls = queueState.addCallsByQueue.get(QUEUE_NAME.IMAGE) || []
    expect(calls).toHaveLength(1)
    expect(calls[0]?.jobName).toBe(TASK_TYPE.MODIFY_ASSET_IMAGE)
    expect(calls[0]?.data.type).toBe(TASK_TYPE.MODIFY_ASSET_IMAGE)
  })

  it('routes Episode cover image jobs to the dedicated image worker handler', async () => {
    const { addTaskJob, QUEUE_NAME } = await import('@/lib/task/queues')

    await addTaskJob({
      taskId: 'task-episode-cover-1',
      type: TASK_TYPE.IMAGE_EPISODE_COVER,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionEpisode',
      targetId: 'episode-1',
      payload: {},
      userId: 'user-1',
    })

    const queuedCalls = queueState.addCallsByQueue.get(QUEUE_NAME.IMAGE) || []
    expect(queuedCalls).toEqual([
      expect.objectContaining({
        jobName: TASK_TYPE.IMAGE_EPISODE_COVER,
        data: expect.objectContaining({ type: TASK_TYPE.IMAGE_EPISODE_COVER }),
      }),
    ])
    const queued = queuedCalls[0]
    expect(queueState.addCallsByQueue.get(QUEUE_NAME.VIDEO) || []).toEqual([])
    expect(TASKTYPE_BEHAVIOR_MATRIX).toContainEqual(expect.objectContaining({
      taskType: TASK_TYPE.IMAGE_EPISODE_COVER,
      chainTest: 'tests/integration/chain/image.chain.test.ts',
      apiContractTest: 'tests/integration/api/contract/direct-submit-routes.test.ts',
    }))

    const { createImageWorker } = await import('@/lib/workers/image.worker')
    createImageWorker()

    expect(workerState.processor).toBeTruthy()
    const queuedJob = toJob(queued!.data)
    await workerState.processor!(queuedJob)

    expect(imageHandlerMock.handleEpisodeCoverImageTask).toHaveBeenCalledWith(queuedJob)
  })

  it('queued image job payload can be consumed by worker handler and persist image fields', async () => {
    const { addTaskJob, QUEUE_NAME } = await import('@/lib/task/queues')
    const { handleAssetHubImageTask } = await import('@/lib/workers/handlers/asset-hub-image-task-handler')

    prismaMock.globalCharacter.findFirst.mockResolvedValue({
      id: 'global-character-1',
      name: 'Hero',
      appearances: [
        {
          id: 'appearance-1',
          appearanceIndex: 0,
          changeReason: 'base',
          description: '黑发，风衣',
          descriptions: null,
        },
      ],
    })

    await addTaskJob({
      taskId: 'task-image-chain-worker-1',
      type: TASK_TYPE.ASSET_HUB_IMAGE,
      locale: 'zh',
      projectId: 'global-asset-hub',
      episodeId: null,
      targetType: 'GlobalCharacter',
      targetId: 'global-character-1',
      payload: { type: 'character', id: 'global-character-1', appearanceIndex: 0 },
      userId: 'user-1',
    })

    const calls = queueState.addCallsByQueue.get(QUEUE_NAME.IMAGE) || []
    const queued = calls[0]?.data
    expect(queued?.type).toBe(TASK_TYPE.ASSET_HUB_IMAGE)

    const result = await handleAssetHubImageTask(toJob(queued!))
    expect(result).toEqual({
      type: 'character',
      appearanceId: 'appearance-1',
      imageCount: 3,
    })

    expect(prismaMock.globalCharacterAppearance.update).toHaveBeenCalledWith({
      where: { id: 'appearance-1' },
      data: {
        imageUrls: JSON.stringify(['cos/global-character-generated.png', 'cos/global-character-generated.png', 'cos/global-character-generated.png']),
        imageUrl: 'cos/global-character-generated.png',
        selectedIndex: null,
      },
    })
  })
})
