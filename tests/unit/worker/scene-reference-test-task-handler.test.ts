import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const sharedMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
}))

const storageMock = vi.hoisted(() => ({
  getSignedUrl: vi.fn((key: string) => `https://signed.example/${key}`),
}))

const handlerSharedMock = vi.hoisted(() => ({
  generateCleanImageToStorage: vi.fn(async (input: GenerationInput) => `${input.keyPrefix}/${input.targetId}.jpg`),
}))

const outboundMock = vi.hoisted(() => ({
  normalizeOptionalReferenceImagesForGeneration: vi.fn(async (urls: string[]) => urls.map((url) => `normalized:${url}`)),
}))

vi.mock('@/lib/workers/shared', () => sharedMock)
vi.mock('@/lib/storage', () => storageMock)
vi.mock('@/lib/media/outbound-image', () => outboundMock)
vi.mock('@/lib/workers/handlers/image-task-handler-shared', () => handlerSharedMock)

import {
  handleSceneReferenceComparisonTask,
  handleSceneReferenceTask,
} from '@/lib/workers/handlers/scene-reference-test-task-handler'

type GenerationInput = {
  userId: string
  modelId: string
  prompt: string
  targetId: string
  keyPrefix: string
  options?: {
    aspectRatio?: string
    referenceImages?: string[]
  }
}

function buildJob(type: TaskJobData['type'], payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: `task-${type}`,
      type,
      locale: 'zh',
      projectId: 'system',
      targetType: 'SceneReferenceTest',
      targetId: 'scene-reference-test',
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker scene-reference-test-task-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('scene reference task -> generates single baseline and selected multi-angle layouts', async () => {
    const result = await handleSceneReferenceTask(buildJob(TASK_TYPE.SCENE_REFERENCE_TEST, {
      imageModel: 'location-model-1',
      sceneDescription: '雨夜寺庙后院，青石地面，旧木门',
      styleRequest: '低饱和武侠电影感',
      layouts: ['three_view', 'overhead_spatial_board'],
    }))

    expect(result.singleView.prompt).toContain('单视图空场景参考图')
    expect(result.multiViews).toHaveLength(2)
    expect(result.multiViews[0]?.prompt).toContain('三视图场景板')
    expect(result.multiViews[1]?.prompt).toContain('空间关系场景板')
    expect(handlerSharedMock.generateCleanImageToStorage).toHaveBeenCalledTimes(3)
    expect(handlerSharedMock.generateCleanImageToStorage.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      modelId: 'location-model-1',
      options: expect.objectContaining({ aspectRatio: '16:9' }),
    }))
  })

  it('comparison task -> keeps prompt identical and changes only the scene reference image', async () => {
    const result = await handleSceneReferenceComparisonTask(buildJob(TASK_TYPE.SCENE_REFERENCE_COMPARISON_TEST, {
      imageModel: 'storyboard-model-1',
      characterImageUrl: 'https://example.com/character.png',
      singleSceneImageUrl: 'https://example.com/single.png',
      storyboardPrompt: '和尚站在雨夜寺庙后院中央',
      aspectRatio: '16:9',
      pairCount: 1,
      variants: [{ id: 'three_view', label: '三视图场景板', imageUrl: 'https://example.com/multi.png' }],
    }))

    expect(result.prompt).toContain('参考图 1 是人物资产')
    expect(result.prompt).toContain('参考图 2 是场景资产')
    expect(result.pairs).toHaveLength(1)

    const singleCall = handlerSharedMock.generateCleanImageToStorage.mock.calls[0]?.[0] as GenerationInput | undefined
    const multiCall = handlerSharedMock.generateCleanImageToStorage.mock.calls[1]?.[0] as GenerationInput | undefined
    expect(singleCall?.prompt).toBe(multiCall?.prompt)
    expect(singleCall?.options?.referenceImages).toEqual([
      'normalized:https://example.com/character.png',
      'normalized:https://example.com/single.png',
    ])
    expect(multiCall?.options?.referenceImages).toEqual([
      'normalized:https://example.com/character.png',
      'normalized:https://example.com/multi.png',
    ])
  })
})
