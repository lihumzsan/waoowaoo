import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

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
          modelId: 'qwen3-tts-vd-2026-01-26',
          modelKey: 'bailian::qwen3-tts-vd-2026-01-26',
          name: 'Qwen3 TTS',
          type: 'audio',
          provider: 'bailian',
        },
        {
          modelId: 'baseaudio/\u97f3\u8272/s2-se',
          modelKey: 'comfyui::baseaudio/\u97f3\u8272/s2-se',
          name: 'ComfyUI · S2 voice design',
          type: 'audio',
          provider: 'comfyui',
        },
      ]),
      customProviders: JSON.stringify([
        {
          id: 'bailian',
          name: 'Alibaba Bailian',
          apiKey: 'k-bailian',
        },
        {
          id: 'comfyui',
          name: 'ComfyUI (Local)',
          baseUrl: 'http://127.0.0.1:8188',
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

describe('api specific - user models audio filter', () => {
  const routeContext = { params: Promise.resolve({}) }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('excludes voice design workflows from the audio model list', async () => {
    const mod = await import('@/app/api/user/models/route')
    const req = buildMockRequest({
      path: '/api/user/models',
      method: 'GET',
    })
    const res = await mod.GET(req, routeContext)

    expect(res.status).toBe(200)
    const body = await res.json() as { audio: Array<{ value: string }> }
    expect(body.audio.map((item) => item.value)).toEqual([
      'bailian::qwen3-tts-vd-2026-01-26',
    ])
  })
})
