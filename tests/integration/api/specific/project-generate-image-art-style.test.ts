import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'
import { planAssetGenerateTask } from '@/lib/assets/services/asset-actions'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const submitTaskMock = vi.hoisted(() => vi.fn<(input: unknown) => Promise<{
  success: boolean
  async: boolean
  taskId: string
  status: string
  runId: string | null
  deduped: boolean
}>>(async () => ({
  success: true,
  async: true,
  taskId: 'task-1',
  status: 'queued',
  runId: null,
  deduped: false,
})))

const configServiceMock = vi.hoisted(() => ({
  getProjectModelConfig: vi.fn(async () => ({
    analysisModel: null,
    characterModel: 'img::character',
    locationModel: 'img::location',
    storyboardModel: null,
    editModel: null,
    videoModel: null,
    videoRatio: '16:9',
    artStyle: 'american-comic',
    capabilityDefaults: {},
    capabilityOverrides: {},
  })),
  buildImageBillingPayload: vi.fn(async (input: { basePayload: Record<string, unknown> }) => ({
    ...input.basePayload,
  })),
}))

const hasOutputMock = vi.hoisted(() => ({
  hasCharacterAppearanceOutput: vi.fn(async () => false),
  hasLocationImageOutput: vi.fn(async () => false),
}))

const billingMock = vi.hoisted(() => ({
  getBillingMode: vi.fn(async () => 'ENFORCE' as const),
  buildDefaultTaskBillingInfo: vi.fn((taskType: string, payload: Record<string, unknown>) => ({
    billable: true,
    source: 'task',
    taskType,
    apiType: 'image',
    model: typeof payload.imageModel === 'string' ? payload.imageModel : 'img::character',
    quantity: 1,
    unit: 'image',
    maxFrozenCost: 1,
    action: taskType,
    status: 'quoted',
  })),
}))

const mutationBatchMock = vi.hoisted(() => ({
  createMutationBatch: vi.fn(async () => ({ id: 'mutation-batch-1' })),
}))

const prismaMock = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(async () => ({
      visualStylePresetSource: 'system',
      visualStylePresetId: 'japanese-anime',
      artStyle: 'japanese-anime',
    })),
  },
  characterAppearance: {
    findUnique: vi.fn(async () => ({
      id: 'appearance-1',
      characterId: 'character-1',
      character: { projectId: 'project-1' },
      imageUrls: '[]',
    })),
  },
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/task/has-output', () => hasOutputMock)
vi.mock('@/lib/billing', () => billingMock)
vi.mock('@/lib/mutation-batch/service', () => mutationBatchMock)
vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: vi.fn(() => 'zh'),
}))

function planCharacter(body: Record<string, unknown>) {
  return planAssetGenerateTask({
    request: buildMockRequest({ path: '/api/assets/character-1/generate', method: 'POST', body }),
    kind: 'character',
    assetId: 'character-1',
    body,
    episodeId: null,
    access: { scope: 'project', userId: 'user-1', projectId: 'project-1' },
  })
}

describe('api specific - novel promotion generate image planning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects legacy artStyle on the unified asset generate route', async () => {
    await expect(planCharacter({
      appearanceId: 'appearance-1',
      artStyle: 'realistic',
    })).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('does not inject american-comic when artStyle is omitted', async () => {
    const planned = await planCharacter({ appearanceId: 'appearance-1' })
    expect(planned.task.payload).not.toHaveProperty('artStyle')
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('rejects invalid artStyle with invalid params', async () => {
    await expect(planCharacter({
      appearanceId: 'appearance-1',
      artStyle: 'anime',
    })).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('uses the project character candidate count for multi-candidate generation', async () => {
    const planned = await planCharacter({ appearanceId: 'appearance-1', count: 6 })
    expect(planned.task.payload.count).toBe(3)
    expect(planned.task.dedupeKey).toBe('image_character:appearance-1:3:style-bible:none')
  })

  it('honors explicit single project character generation count', async () => {
    const planned = await planCharacter({ appearanceId: 'appearance-1', count: 1 })
    expect(planned.task.payload.count).toBe(1)
    expect(planned.task.dedupeKey).toBe('image_character:appearance-1:1:style-bible:none')
  })
})
