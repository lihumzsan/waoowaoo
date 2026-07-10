import {
  afterEach,
  beforeEach,
  describe,
  executeFalVideoGeneration,
  expect,
  it,
  startScenarioServer,
  vi,
} from './fal-video-provider.fixture'

describe('provider contract - fal video', () => {
  let server: Awaited<ReturnType<typeof startScenarioServer>> | null = null

  beforeEach(async () => {
    vi.clearAllMocks()
    server = await startScenarioServer()
    process.env.FAL_QUEUE_BASE_URL = `${server.baseUrl}/fal`
  })

  afterEach(async () => {
    delete process.env.FAL_QUEUE_BASE_URL
    await server?.close()
    server = null
  })

  it('submits Seedance 2.0 Fast single-image requests to fast image-to-video', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/fal/bytedance/seedance-2.0/fast/image-to-video',
      mode: 'success',
      submitResponse: {
        status: 200,
        body: { request_id: 'req_seedance_fast_i2v_1' },
      },
    })

    const result = await executeFalVideoGeneration({
      userId: 'user-1',
      selection: {
        provider: 'fal',
        modelId: 'bytedance/seedance-2.0/fast',
        modelKey: 'fal::bytedance/seedance-2.0/fast',
        variantSubKind: 'official',
      },
      imageUrl: 'https://example.com/start.png',
      options: {
        prompt: 'A fast production render.',
        resolution: '720p',
        duration: 4,
        aspectRatio: '16:9',
        generateAudio: true,
      },
    })

    expect(result).toMatchObject({
      endpoint: 'bytedance/seedance-2.0/fast/image-to-video',
      externalId: 'FAL:VIDEO:bytedance/seedance-2.0/fast/image-to-video:req_seedance_fast_i2v_1',
    })
    const requests = server!.getRequests('POST', '/fal/bytedance/seedance-2.0/fast/image-to-video')
    expect(requests).toHaveLength(1)
    expect(JSON.parse(requests[0]?.bodyText || '{}')).toEqual({
      prompt: 'A fast production render.',
      image_url: 'https://example.com/start.png',
      resolution: '720p',
      duration: '4',
      aspect_ratio: '16:9',
      generate_audio: true,
    })
  })

  it('submits Seedance 2.0 Fast multi-reference requests to fast reference-to-video', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/fal/bytedance/seedance-2.0/fast/reference-to-video',
      mode: 'success',
      submitResponse: {
        status: 200,
        body: { request_id: 'req_seedance_fast_ref_1' },
      },
    })

    const result = await executeFalVideoGeneration({
      userId: 'user-1',
      selection: {
        provider: 'fal',
        modelId: 'bytedance/seedance-2.0/fast',
        modelKey: 'fal::bytedance/seedance-2.0/fast',
        variantSubKind: 'official',
      },
      imageUrl: 'https://example.com/hero.png',
      options: {
        prompt: 'Use @Image1 as the hero and @Image2 as the location.',
        referenceImages: ['https://example.com/location.png'],
        resolution: '480p',
        duration: 6,
        aspectRatio: 'auto',
        generateAudio: false,
      },
    })

    expect(result).toMatchObject({
      endpoint: 'bytedance/seedance-2.0/fast/reference-to-video',
      externalId: 'FAL:VIDEO:bytedance/seedance-2.0/fast/reference-to-video:req_seedance_fast_ref_1',
    })
    const requests = server!.getRequests('POST', '/fal/bytedance/seedance-2.0/fast/reference-to-video')
    expect(requests).toHaveLength(1)
    expect(JSON.parse(requests[0]?.bodyText || '{}')).toEqual({
      prompt: 'Use @Image1 as the hero and @Image2 as the location.',
      image_urls: ['https://example.com/hero.png', 'https://example.com/location.png'],
      resolution: '480p',
      duration: '6',
      aspect_ratio: 'auto',
      generate_audio: false,
    })
  })

  it('submits Seedance 2.0 Fast prompt-only requests to fast text-to-video', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/fal/bytedance/seedance-2.0/fast/text-to-video',
      mode: 'success',
      submitResponse: {
        status: 200,
        body: { request_id: 'req_seedance_fast_text_1' },
      },
    })

    const result = await executeFalVideoGeneration({
      userId: 'user-1',
      selection: {
        provider: 'fal',
        modelId: 'bytedance/seedance-2.0/fast',
        modelKey: 'fal::bytedance/seedance-2.0/fast',
        variantSubKind: 'official',
      },
      imageUrl: '',
      options: {
        prompt: 'A fast prompt-only cinematic scene.',
        resolution: '720p',
        duration: 5,
        aspectRatio: '16:9',
        generateAudio: true,
      },
    })

    expect(result).toMatchObject({
      endpoint: 'bytedance/seedance-2.0/fast/text-to-video',
      externalId: 'FAL:VIDEO:bytedance/seedance-2.0/fast/text-to-video:req_seedance_fast_text_1',
    })
    const requests = server!.getRequests('POST', '/fal/bytedance/seedance-2.0/fast/text-to-video')
    expect(requests).toHaveLength(1)
    expect(JSON.parse(requests[0]?.bodyText || '{}')).toEqual({
      prompt: 'A fast prompt-only cinematic scene.',
      resolution: '720p',
      duration: '5',
      aspect_ratio: '16:9',
      generate_audio: true,
    })
  })

  it('submits Veo 3.1 Fast single-image requests to image-to-video without reference images', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/fal/fal-ai/veo3.1/fast/image-to-video',
      mode: 'success',
      submitResponse: {
        status: 200,
        body: { request_id: 'req_veo31_i2v_1' },
      },
    })

    const result = await executeFalVideoGeneration({
      userId: 'user-1',
      selection: {
        provider: 'fal',
        modelId: 'fal-veo31',
        modelKey: 'fal::fal-veo31',
        variantSubKind: 'official',
      },
      imageUrl: 'https://example.com/start.png',
      options: {
        prompt: 'Animate the start frame with a gentle camera push.',
        resolution: '720p',
        duration: 8,
        aspectRatio: '16:9',
      },
    })

    expect(result).toMatchObject({
      endpoint: 'fal-ai/veo3.1/fast/image-to-video',
      externalId: 'FAL:VIDEO:fal-ai/veo3.1/fast/image-to-video:req_veo31_i2v_1',
    })
    const requests = server!.getRequests('POST', '/fal/fal-ai/veo3.1/fast/image-to-video')
    expect(requests).toHaveLength(1)
    expect(JSON.parse(requests[0]?.bodyText || '{}')).toEqual({
      image_url: 'https://example.com/start.png',
      prompt: 'Animate the start frame with a gentle camera push.',
      aspect_ratio: '16:9',
      duration: '8s',
      resolution: '720p',
      generate_audio: false,
    })
  })

  it('submits Veo 3.1 Fast multi-reference requests to reference-to-video', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/fal/fal-ai/veo3.1/fast/reference-to-video',
      mode: 'success',
      submitResponse: {
        status: 200,
        body: { request_id: 'req_veo31_ref_1' },
      },
    })

    const result = await executeFalVideoGeneration({
      userId: 'user-1',
      selection: {
        provider: 'fal',
        modelId: 'fal-veo31',
        modelKey: 'fal::fal-veo31',
        variantSubKind: 'official',
      },
      imageUrl: 'https://example.com/hero.png',
      options: {
        prompt: 'Keep the hero from @Image1 and stage them in @Image2.',
        referenceImages: ['https://example.com/hero.png', 'https://example.com/location.png'],
        resolution: '720p',
        duration: 8,
        aspectRatio: '16:9',
        generateAudio: true,
      },
    })

    expect(result).toMatchObject({
      endpoint: 'fal-ai/veo3.1/fast/reference-to-video',
      externalId: 'FAL:VIDEO:fal-ai/veo3.1/fast/reference-to-video:req_veo31_ref_1',
    })
    const requests = server!.getRequests('POST', '/fal/fal-ai/veo3.1/fast/reference-to-video')
    expect(requests).toHaveLength(1)
    expect(JSON.parse(requests[0]?.bodyText || '{}')).toEqual({
      image_urls: ['https://example.com/hero.png', 'https://example.com/location.png'],
      prompt: 'Keep the hero from @Image1 and stage them in @Image2.',
      aspect_ratio: '16:9',
      duration: '8s',
      resolution: '720p',
      generate_audio: true,
    })
  })
})
