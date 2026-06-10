import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'
import {
  CODEX_DEFAULT_EXECUTABLE_PATH,
  CODEX_DEFAULT_IMAGE_MODEL_ID,
  CODEX_DEFAULT_IMAGE_MODEL_KEY,
  CODEX_PROVIDER_KEY,
} from '@/lib/providers/codex/constants'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    findUnique: vi.fn(async () => ({
      customModels: JSON.stringify([
        {
          modelId: CODEX_DEFAULT_IMAGE_MODEL_ID,
          modelKey: CODEX_DEFAULT_IMAGE_MODEL_KEY,
          name: 'Codex Image',
          type: 'image',
          provider: CODEX_PROVIDER_KEY,
        },
      ]),
      customProviders: JSON.stringify([
        {
          id: CODEX_PROVIDER_KEY,
          name: 'Codex (Local)',
          baseUrl: CODEX_DEFAULT_EXECUTABLE_PATH,
        },
      ]),
    })),
  },
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/model-capabilities/catalog', () => ({
  findBuiltinCapabilities: vi.fn(() => undefined),
}))
vi.mock('@/lib/model-pricing/catalog', () => ({
  findBuiltinPricingCatalogEntry: vi.fn(() => undefined),
}))

describe('api specific - user models codex', () => {
  const routeContext = { params: Promise.resolve({}) }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns Codex Image options without requiring an api key', async () => {
    const mod = await import('@/app/api/user/models/route')
    const req = buildMockRequest({
      path: '/api/user/models',
      method: 'GET',
    })
    const res = await mod.GET(req, routeContext)

    expect(res.status).toBe(200)
    const body = await res.json() as {
      image: Array<{ value: string; label: string; provider?: string; providerName?: string }>
    }
    expect(body.image).toEqual([
      expect.objectContaining({
        value: CODEX_DEFAULT_IMAGE_MODEL_KEY,
        label: 'Codex Image',
        provider: CODEX_PROVIDER_KEY,
        providerName: 'Codex (Local)',
      }),
    ])
  })
})
