import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { buildMockRequest } from '../../../helpers/request'
import { TASK_TYPE } from '@/lib/task/types'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn<() => Promise<{ session: { user: { id: string } } } | Response>>(async () => ({
    session: { user: { id: 'user-1' } },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => await run(prismaMock)),
  globalAssetFolder: {
    findUnique: vi.fn(),
  },
  globalCharacter: {
    create: vi.fn(async () => ({ id: 'character-1', userId: 'user-1' })),
    findUnique: vi.fn(async () => ({
      id: 'character-1',
      userId: 'user-1',
      name: 'Hero',
      appearances: [],
    })),
  },
  globalCharacterAppearance: {
    create: vi.fn(async () => ({ id: 'appearance-1' })),
  },
}))

const mediaAttachMock = vi.hoisted(() => ({
  attachMediaFieldsToGlobalCharacter: vi.fn(async (value: unknown) => value),
}))

const mediaServiceMock = vi.hoisted(() => ({
  resolveMediaRefFromLegacyValue: vi.fn(async () => null),
}))

const configServiceMock = vi.hoisted(() => ({
  getUserModelConfig: vi.fn(async () => ({ analysisModel: 'analysis-model' })),
}))

const submitterMock = vi.hoisted(() => ({
  prepareTaskSubmissionInput: vi.fn<(input: {
    projectId: string
    type: string
    targetType: string
    targetId: string
    payload: Record<string, unknown>
    dedupeKey?: string | null
  }) => Promise<unknown>>(async (input) => ({ input, billingMode: 'OFF' })),
}))

const billingMock = vi.hoisted(() => ({
  buildDefaultTaskBillingInfo: vi.fn(() => null),
  isBillableTaskType: vi.fn(() => false),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/media/attach', () => mediaAttachMock)
vi.mock('@/lib/media/service', () => mediaServiceMock)
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/task/submitter', () => submitterMock)
vi.mock('@/lib/task/transactional-create', () => ({
  persistSubmittedTaskBatchInTransaction: vi.fn(async (params) => {
    const tasks = params.inputs.map((input: Record<string, unknown>) => ({
      task: { ...input, id: 'task-1', status: 'queued', billingInfo: null },
      deduped: false,
    }))
    await params.onBatchCreatedInTransaction?.(params.tx, tasks)
    return tasks
  }),
}))
vi.mock('@/lib/billing', () => billingMock)

describe('api specific - asset hub character reference forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.globalAssetFolder.findUnique.mockResolvedValue(null)
  })

  it('rejects the retired create-and-submit payload before creating asset records', async () => {
    const mod = await import('@/app/api/asset-hub/characters/route')
    const req = buildMockRequest({
      path: '/api/asset-hub/characters',
      method: 'POST',
      headers: {
        'accept-language': 'zh-CN,zh;q=0.9',
      },
      body: {
        name: 'Hero',
        generateFromReference: true,
        referenceImageUrl: 'https://example.com/ref.png',
        customDescription: '冷静，黑发',
        count: 5,
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.details).toMatchObject({
      code: 'ASSET_HUB_CHARACTER_REFERENCE_GENERATION_SEPARATE_OPERATION_REQUIRED',
      field: 'referenceImageUrl',
    })
    expect(prismaMock.globalCharacter.create).not.toHaveBeenCalled()
    expect(submitterMock.prepareTaskSubmissionInput).not.toHaveBeenCalled()
  })

  it('submits description extraction through its distinct text Operation', async () => {
    const mod = await import('@/app/api/asset-hub/reference-to-character/extract/route')
    const req = buildMockRequest({
      path: '/api/asset-hub/reference-to-character',
      method: 'POST',
      headers: {
        'accept-language': 'zh-CN,zh;q=0.9',
      },
      body: {
        referenceImageUrls: ['https://example.com/ref.png'],
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)

    expect(submitterMock.prepareTaskSubmissionInput).toHaveBeenCalledTimes(1)
    const submitted = submitterMock.prepareTaskSubmissionInput.mock.calls[0]?.[0] as {
      projectId?: string
      type?: string
      targetType?: string
      targetId?: string
      payload?: Record<string, unknown>
      dedupeKey?: string | null
    } | undefined

    expect(submitted?.projectId).toBe('global-asset-hub')
    expect(submitted?.type).toBe(TASK_TYPE.ASSET_HUB_REFERENCE_CHARACTER_DESCRIPTION_EXTRACT)
    expect(submitted?.targetType).toBe('GlobalAssetHub')
    expect(submitted?.targetId).toBe('global-asset-hub')
    expect(submitted?.dedupeKey).toMatch(/^asset_hub_extract_reference_character_description:/)

    const forwarded = (submitted?.payload || {}) as {
      locale?: string
      meta?: { locale?: string }
      referenceImageUrls?: string[]
      analysisModel?: string
      extractOnly?: boolean
    }

    expect(forwarded.meta?.locale).toBe('zh')
    expect(forwarded.referenceImageUrls).toEqual(['https://example.com/ref.png'])
    expect(forwarded.analysisModel).toBe('analysis-model')
    expect(forwarded.extractOnly).toBe(true)
  })

  it('rejects image generation until an immutable plan grant is supplied', async () => {
    const mod = await import('@/app/api/asset-hub/reference-to-character/route')
    const req = buildMockRequest({
      path: '/api/asset-hub/reference-to-character',
      method: 'POST',
      headers: { 'accept-language': 'en' },
      body: {
        referenceImageUrls: ['https://example.com/ref.png'],
        characterId: 'character-1',
        appearanceId: 'appearance-1',
        isBackgroundJob: true,
        count: 1,
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: { details: { code: 'OPERATION_APPROVAL_GRANT_REQUIRED' } },
    })
    expect(submitterMock.prepareTaskSubmissionInput).not.toHaveBeenCalled()
  })

  it('returns unauthorized when auth fails', async () => {
    authMock.requireUserAuth.mockResolvedValueOnce(
      NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 }),
    )
    const mod = await import('@/app/api/asset-hub/characters/route')
    const req = buildMockRequest({
      path: '/api/asset-hub/characters',
      method: 'POST',
      body: { name: 'Hero' },
    })

    const res = await mod.POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(401)
  })
})
