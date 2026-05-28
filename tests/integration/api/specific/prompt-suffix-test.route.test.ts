import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const runtimeConfigMock = vi.hoisted(() => ({
  getModelsByType: vi.fn(async () => [
    {
      modelId: 'image-model',
      modelKey: 'provider::image-model',
      name: 'Image Model',
      type: 'image',
      provider: 'provider',
      price: 1,
    },
  ]),
}))

const configServiceMock = vi.hoisted(() => ({
  getUserModelConfig: vi.fn(async () => ({
    analysisModel: null,
    characterModel: null,
    locationModel: null,
    storyboardModel: null,
    editModel: null,
    videoModel: null,
    audioModel: null,
    musicModel: null,
    capabilityDefaults: {},
  })),
  resolveModelCapabilityGenerationOptions: vi.fn(() => ({ quality: 'standard' })),
}))

const engineMock = vi.hoisted(() => ({
  generateImage: vi.fn(async () => ({
    success: true,
    imageUrl: 'https://example.com/generated.jpg',
  })),
}))

const mediaProcessMock = vi.hoisted(() => ({
  processMediaResult: vi.fn(async () => 'images/prompt-suffix-test/generated.jpg'),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/user-api/runtime-config', () => runtimeConfigMock)
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/ai-exec/engine', () => engineMock)
vi.mock('@/lib/ai-exec/async-poll', () => ({ pollAsyncTask: vi.fn() }))
vi.mock('@/lib/media-process', () => mediaProcessMock)

describe('api specific - prompt suffix test route', () => {
  const routeContext = { params: Promise.resolve({}) }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates a test image with the selected image model and final prompt', async () => {
    const mod = await import('@/app/api/user/prompt-suffix-test/route')
    const req = buildMockRequest({
      path: '/api/user/prompt-suffix-test',
      method: 'POST',
      body: {
        modelKey: 'provider::image-model',
        variantId: 'compact_style',
        basePrompt: '主体提示词',
        suffix: '短后缀',
        aspectRatio: '16:9',
      },
    })
    const res = await mod.POST(req, routeContext)

    expect(res.status).toBe(200)
    const body = await res.json() as {
      variantId: string
      modelKey: string
      displayUrl: string
      finalPrompt: string
      promptLength: number
    }
    expect(body).toMatchObject({
      variantId: 'compact_style',
      modelKey: 'provider::image-model',
      displayUrl: '/api/storage/sign?key=images%2Fprompt-suffix-test%2Fgenerated.jpg',
      finalPrompt: '主体提示词\n\n短后缀',
      promptLength: '主体提示词\n\n短后缀'.length,
    })
    expect(engineMock.generateImage).toHaveBeenCalledWith(
      'user-1',
      'provider::image-model',
      '主体提示词\n\n短后缀',
      {
        aspectRatio: '16:9',
        quality: 'standard',
      },
    )
    expect(mediaProcessMock.processMediaResult).toHaveBeenCalledWith(expect.objectContaining({
      source: 'https://example.com/generated.jpg',
      type: 'image',
      keyPrefix: 'prompt-suffix-test',
    }))
  })

  it('rejects models that are not configured as user image models', async () => {
    const mod = await import('@/app/api/user/prompt-suffix-test/route')
    const req = buildMockRequest({
      path: '/api/user/prompt-suffix-test',
      method: 'POST',
      body: {
        modelKey: 'provider::missing',
        variantId: 'compact_style',
        basePrompt: '主体提示词',
        suffix: '短后缀',
        aspectRatio: '16:9',
      },
    })
    const res = await mod.POST(req, routeContext)

    expect(res.status).toBe(400)
    expect(engineMock.generateImage).not.toHaveBeenCalled()
  })
})
