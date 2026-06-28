import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { TASK_TYPE } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  globalCharacterAppearance: {
    findFirst: vi.fn(),
  },
  globalLocationImage: {
    createMany: vi.fn(),
  },
}))

const submitTaskMock = vi.hoisted(() => vi.fn(async () => ({
  success: true,
  async: true,
  taskId: 'task-1',
  status: 'queued',
  runId: null,
  deduped: false,
})))

const configMock = vi.hoisted(() => ({
  getUserModelConfig: vi.fn(async () => ({
    characterModel: 'fal::gpt-image-2',
    locationModel: 'fal::gpt-image-2',
  })),
  getProjectModelConfig: vi.fn(),
  buildImageBillingPayload: vi.fn(),
  buildImageBillingPayloadFromUserConfig: vi.fn((input: {
    imageModel: string | null
    basePayload: Record<string, unknown>
  }) => ({
    ...input.basePayload,
    imageModel: input.imageModel,
    generationOptions: {
      resolution: '1K',
      aspectRatio: '1:1',
      quality: 'medium',
    },
  })),
}))

const hasOutputMock = vi.hoisted(() => ({
  hasCharacterAppearanceOutput: vi.fn(async () => false),
  hasGlobalCharacterAppearanceOutput: vi.fn(async () => false),
  hasGlobalLocationImageOutput: vi.fn(async () => false),
  hasGlobalLocationOutput: vi.fn(async () => false),
  hasLocationImageOutput: vi.fn(async () => false),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/config-service', () => configMock)
vi.mock('@/lib/task/has-output', () => hasOutputMock)

describe('global character generate task target', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.globalCharacterAppearance.findFirst.mockResolvedValue({ id: 'appearance-1' })
  })

  it('uses the global character appearance as the task target', async () => {
    const { submitAssetGenerateTask } = await import('@/lib/assets/services/asset-actions')

    await submitAssetGenerateTask({
      request: new Request('http://localhost/api/assets/character-1/generate') as unknown as NextRequest,
      kind: 'character',
      assetId: 'character-1',
      body: {
        scope: 'global',
        kind: 'character',
        appearanceIndex: 0,
        count: 2,
        meta: { locale: 'zh' },
      },
      access: {
        scope: 'global',
        userId: 'user-1',
      },
    })

    expect(prismaMock.globalCharacterAppearance.findFirst).toHaveBeenCalledWith({
      where: {
        characterId: 'character-1',
        appearanceIndex: 0,
        character: {
          userId: 'user-1',
        },
      },
      select: { id: true },
    })

    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      type: TASK_TYPE.ASSET_HUB_IMAGE,
      projectId: 'global-asset-hub',
      targetType: 'GlobalCharacterAppearance',
      targetId: 'appearance-1',
      payload: expect.objectContaining({
        id: 'character-1',
        type: 'character',
        appearanceId: 'appearance-1',
        appearanceIndex: 0,
      }),
    }))
  })

  it('plans global location generation without creating image slots', async () => {
    const { planAssetGenerateTask } = await import('@/lib/assets/services/asset-actions')

    const plan = await planAssetGenerateTask({
      request: new Request('http://localhost/api/assets/location-1/generate') as unknown as NextRequest,
      kind: 'location',
      assetId: 'location-1',
      body: {
        scope: 'global',
        kind: 'location',
        count: 2,
        meta: { locale: 'zh' },
      },
      access: {
        scope: 'global',
        userId: 'user-1',
      },
    })

    expect(plan.task.taskType).toBe(TASK_TYPE.ASSET_HUB_IMAGE)
    expect(plan.task.target).toEqual({
      targetType: 'GlobalLocation',
      targetId: 'location-1',
    })
    expect(prismaMock.globalLocationImage.createMany).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })
})
