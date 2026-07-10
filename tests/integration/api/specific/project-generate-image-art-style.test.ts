import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

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

describe('api specific - novel promotion generate image art style', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects legacy artStyle on the unified asset generate route', async () => {
    const mod = await import('@/app/api/assets/[assetId]/generate/route')
    const req = buildMockRequest({
      path: '/api/assets/character-1/generate',
      method: 'POST',
      body: {
        scope: 'project',
        kind: 'character',
        projectId: 'project-1',
        appearanceId: 'appearance-1',
        artStyle: 'realistic',
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ assetId: 'character-1' }) })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_PARAMS')
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('does not inject american-comic when artStyle is omitted', async () => {
    const mod = await import('@/app/api/assets/[assetId]/generate/route')
    const req = buildMockRequest({
      path: '/api/assets/character-1/generate',
      method: 'POST',
      body: {
        scope: 'project',
        kind: 'character',
        projectId: 'project-1',
        appearanceId: 'appearance-1',
        confirmed: true,
        confirmedMaxCost: 1,
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ assetId: 'character-1' }) })
    expect(res.status).toBe(200)

    const submitArg = submitTaskMock.mock.calls[0]?.[0] as { payload?: Record<string, unknown> } | undefined
    expect(submitArg?.payload).not.toHaveProperty('artStyle')
  })

  it('rejects invalid artStyle with invalid params', async () => {
    const mod = await import('@/app/api/assets/[assetId]/generate/route')
    const req = buildMockRequest({
      path: '/api/assets/character-1/generate',
      method: 'POST',
      body: {
        scope: 'project',
        kind: 'character',
        projectId: 'project-1',
        appearanceId: 'appearance-1',
        artStyle: 'anime',
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ assetId: 'character-1' }) })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_PARAMS')
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('uses the project character candidate count for multi-candidate generation', async () => {
    const mod = await import('@/app/api/assets/[assetId]/generate/route')
    const req = buildMockRequest({
      path: '/api/assets/character-1/generate',
      method: 'POST',
      body: {
        scope: 'project',
        kind: 'character',
        projectId: 'project-1',
        appearanceId: 'appearance-1',
        count: 6,
        confirmed: true,
        confirmedMaxCost: 1,
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ assetId: 'character-1' }) })
    expect(res.status).toBe(200)

    const submitArg = submitTaskMock.mock.calls[0]?.[0] as {
      payload?: Record<string, unknown>
      dedupeKey?: string
    } | undefined
    expect(submitArg?.payload?.count).toBe(3)
    expect(submitArg?.dedupeKey).toBe('image_character:appearance-1:3:style-bible:none')
  })

  it('honors explicit single project character generation count', async () => {
    const mod = await import('@/app/api/assets/[assetId]/generate/route')
    const req = buildMockRequest({
      path: '/api/assets/character-1/generate',
      method: 'POST',
      body: {
        scope: 'project',
        kind: 'character',
        projectId: 'project-1',
        appearanceId: 'appearance-1',
        count: 1,
        confirmed: true,
        confirmedMaxCost: 1,
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ assetId: 'character-1' }) })
    expect(res.status).toBe(200)

    const submitArg = submitTaskMock.mock.calls[0]?.[0] as {
      payload?: Record<string, unknown>
      dedupeKey?: string
    } | undefined
    expect(submitArg?.payload?.count).toBe(1)
    expect(submitArg?.dedupeKey).toBe('image_character:appearance-1:1:style-bible:none')
  })
})
