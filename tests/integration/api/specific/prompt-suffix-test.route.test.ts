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
    analysisModel: null as string | null,
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
  executeAiTextStep: vi.fn(async (_input: unknown) => ({
    text: JSON.stringify({
      sourceText: '赛博朋克雨夜街头，一个侦探站在霓虹灯下。',
      styleText: '写实赛博朋克，霓虹雨夜，电影感低饱和。',
      storyboard: {
        panel: {
          panel_id: 'generated_prompt',
          shot_type: '中景',
          camera_move: '低机位固定镜头',
          description: '侦探站在雨夜霓虹街头',
          image_prompt: '单张电影分镜图，写实赛博朋克雨夜街头，16:9画幅。一个穿透明雨衣的侦探站在霓虹灯下，雨水反射蓝紫色光，低机位中景，35mm，自然浅景深。禁止文字，禁止字幕，禁止水印，禁止logo。',
          location: '赛博朋克雨夜街头',
          characters: [{ name: '侦探', appearance: '透明雨衣' }],
          source_text: '赛博朋克雨夜街头，一个侦探站在霓虹灯下。',
          shot_blocking: {
            locationName: '赛博朋克雨夜街头',
            absolutePosition: '侦探站在霓虹灯牌下方的人行道上',
            relativePosition: '侦探位于湿润街面前方，霓虹灯牌在身后上方',
            screenPosition: '画面中部偏左',
            cameraPlacement: '低机位平拍，面向侦探与街道纵深',
            composition: '人物和霓虹灯牌形成竖向视觉中心',
          },
        },
      },
    }),
    reasoning: '',
    usage: { promptTokens: 100, completionTokens: 100, totalTokens: 200 },
  })),
}))

const mediaProcessMock = vi.hoisted(() => ({
  processMediaResult: vi.fn(async () => 'images/prompt-suffix-test/generated.jpg'),
}))

const billingMock = vi.hoisted(() => ({
  withTextBilling: vi.fn(async (
    _userId: string,
    _model: string,
    _maxInputTokens: number,
    _recordParams: unknown,
    generateFn: () => Promise<unknown>,
  ) => await generateFn()),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/user-api/runtime-config', () => runtimeConfigMock)
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/ai-exec/engine', () => engineMock)
vi.mock('@/lib/ai-exec/async-poll', () => ({ pollAsyncTask: vi.fn() }))
vi.mock('@/lib/media-process', () => mediaProcessMock)
vi.mock('@/lib/billing', () => billingMock)

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
        variantId: 'medium_structured',
        finalPrompt: '完整最终提示词',
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
      variantId: 'medium_structured',
      modelKey: 'provider::image-model',
      displayUrl: '/api/storage/sign?key=images%2Fprompt-suffix-test%2Fgenerated.jpg',
      finalPrompt: '完整最终提示词',
      promptLength: '完整最终提示词'.length,
    })
    expect(engineMock.generateImage).toHaveBeenCalledWith(
      'user-1',
      'provider::image-model',
      '完整最终提示词',
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
        variantId: 'medium_structured',
        finalPrompt: '完整最终提示词',
        aspectRatio: '16:9',
      },
    })
    const res = await mod.POST(req, routeContext)

    expect(res.status).toBe(400)
    expect(engineMock.generateImage).not.toHaveBeenCalled()
  })

  it('expands a loose scene idea into storyboard json with the configured analysis model', async () => {
    configServiceMock.getUserModelConfig.mockResolvedValueOnce({
      analysisModel: 'llm::analysis-model',
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: null,
      audioModel: null,
      musicModel: null,
      capabilityDefaults: {},
    })
    const mod = await import('@/app/api/user/prompt-suffix-test/expand/route')
    const req = buildMockRequest({
      path: '/api/user/prompt-suffix-test/expand',
      method: 'POST',
      body: {
        idea: '赛博朋克雨夜街头',
        locale: 'zh',
        aspectRatio: '16:9',
        styleText: '写实赛博朋克，霓虹雨夜',
        styleBibleText: '禁止文字，禁止水印。',
      },
    })
    const res = await mod.POST(req, routeContext)

    expect(res.status).toBe(200)
    const body = await res.json() as {
      analysisModel: string
      sourceText: string
      styleText: string
      storyboardJson: string
      finalImagePrompt: string
    }
    expect(body.analysisModel).toBe('llm::analysis-model')
    expect(body.sourceText).toBe('赛博朋克雨夜街头，一个侦探站在霓虹灯下。')
    expect(body.styleText).toBe('写实赛博朋克，霓虹雨夜，电影感低饱和。')
    expect(body.storyboardJson).toContain('"panel_id": "generated_prompt"')
    expect(body.storyboardJson).toContain('"shot_blocking"')
    expect(body.finalImagePrompt).toContain('透明雨衣的侦探')
    expect(billingMock.withTextBilling).toHaveBeenCalledWith(
      'user-1',
      'llm::analysis-model',
      expect.any(Number),
      expect.objectContaining({ projectId: 'prompt-suffix-test', action: 'prompt_suffix_test_expand' }),
      expect.any(Function),
    )
    const firstTextCall = engineMock.executeAiTextStep.mock.calls[0]?.[0] as {
      readonly userId?: string
      readonly model?: string
      readonly temperature?: number
      readonly reasoning?: boolean
      readonly action?: string
      readonly messages?: ReadonlyArray<{ readonly content: string }>
    } | undefined
    expect(firstTextCall).toMatchObject({
      userId: 'user-1',
      model: 'llm::analysis-model',
      temperature: 0.35,
      reasoning: false,
      action: 'prompt_suffix_test_expand',
    })
    expect(firstTextCall?.messages?.[0]?.content).toContain('赛博朋克雨夜街头')
    expect(firstTextCall?.messages?.[0]?.content).toContain('只输出 JSON')
  })

  it('rejects idea expansion when analysis model is not configured', async () => {
    const mod = await import('@/app/api/user/prompt-suffix-test/expand/route')
    const req = buildMockRequest({
      path: '/api/user/prompt-suffix-test/expand',
      method: 'POST',
      body: {
        idea: '赛博朋克雨夜街头',
        locale: 'zh',
        aspectRatio: '16:9',
        styleText: '写实赛博朋克，霓虹雨夜',
        styleBibleText: '禁止文字，禁止水印。',
      },
    })
    const res = await mod.POST(req, routeContext)

    expect(res.status).toBe(400)
    expect(engineMock.executeAiTextStep).not.toHaveBeenCalled()
  })
})
