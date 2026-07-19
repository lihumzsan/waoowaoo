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
          modelId: 'basevideo/demo/LTX2.3-fast',
          modelKey: 'comfyui::basevideo/demo/LTX2.3-fast',
          name: 'Old LTX2.3',
          type: 'video',
          provider: 'comfyui',
        },
        {
          modelId: 'basevideo/ltx23-profiles/t8-smooth-first-last-frame',
          modelKey: 'comfyui::basevideo/ltx23-profiles/t8-smooth-first-last-frame',
          name: 'Old smooth first/last frame',
          type: 'video',
          provider: 'comfyui',
        },
      ]),
      customProviders: JSON.stringify([
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

describe('api specific - user models ComfyUI LTX2.3 filter', () => {
  const routeContext = { params: Promise.resolve({}) }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hides removed LTX2.3 models and keeps Goon as the only first-last-frame helper', async () => {
    const mod = await import('@/app/api/user/models/route')
    const req = buildMockRequest({
      path: '/api/user/models',
      method: 'GET',
    })
    const res = await mod.GET(req, routeContext)

    expect(res.status).toBe(200)
    const body = await res.json() as {
      video: Array<{ value: string; label: string }>
    }
    const values = body.video.map((item) => item.value)

    expect(values).not.toContain('comfyui::basevideo/demo/LTX2.3-fast')
    expect(values).not.toContain('comfyui::basevideo/ltx23-profiles/t8-smooth-first-last-frame')
    expect(values).toContain('comfyui::basevideo/ltx23-profiles/goon-first-last-frame-2stage')
    expect(values).toContain('comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2')
    expect(values).toContain('comfyui::basevideo/ltx23-profiles/t8-multishot-precise-promptrelay-kj-720p')
    expect(values).toContain('comfyui::basevideo/seedance2/bernini-480p-i2v')
    expect(body.video.find((item) => item.value.endsWith('t8-multishot-precise-promptrelay-kj-720p'))?.label)
      .toBe('ComfyUI · LTX2.3 多镜头精准 PromptRelay 720p')
  })
})
