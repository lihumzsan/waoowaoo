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

  it('submits Kling O3 Standard image-to-video requests with start and end frames', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/fal/fal-ai/kling-video/o3/standard/image-to-video',
      mode: 'success',
      submitResponse: {
        status: 200,
        body: { request_id: 'req_kling_o3_standard_1' },
      },
    })

    const result = await executeFalVideoGeneration({
      userId: 'user-1',
      selection: {
        provider: 'fal',
        modelId: 'fal-ai/kling-video/o3/standard/image-to-video',
        modelKey: 'fal::fal-ai/kling-video/o3/standard/image-to-video',
        variantSubKind: 'official',
      },
      imageUrl: 'https://example.com/start.png',
      options: {
        prompt: 'Animate the transition between the two frames.',
        duration: 10,
        aspectRatio: '16:9',
        lastFrameImageUrl: 'https://example.com/end.png',
        generateAudio: false,
      },
    })

    expect(result).toMatchObject({
      endpoint: 'fal-ai/kling-video/o3/standard/image-to-video',
      externalId: 'FAL:VIDEO:fal-ai/kling-video/o3/standard/image-to-video:req_kling_o3_standard_1',
    })
    const requests = server!.getRequests('POST', '/fal/fal-ai/kling-video/o3/standard/image-to-video')
    expect(requests).toHaveLength(1)
    expect(JSON.parse(requests[0]?.bodyText || '{}')).toEqual({
      image_url: 'https://example.com/start.png',
      prompt: 'Animate the transition between the two frames.',
      aspect_ratio: '16:9',
      duration: '10',
      end_image_url: 'https://example.com/end.png',
      generate_audio: false,
    })
  })

  it('submits Kling O3 Pro image-to-video requests to the pro endpoint', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/fal/fal-ai/kling-video/o3/pro/image-to-video',
      mode: 'success',
      submitResponse: {
        status: 200,
        body: { request_id: 'req_kling_o3_pro_1' },
      },
    })

    const result = await executeFalVideoGeneration({
      userId: 'user-1',
      selection: {
        provider: 'fal',
        modelId: 'fal-ai/kling-video/o3/pro/image-to-video',
        modelKey: 'fal::fal-ai/kling-video/o3/pro/image-to-video',
        variantSubKind: 'official',
      },
      imageUrl: 'https://example.com/start.png',
      options: {
        prompt: 'Generate a polished cinematic shot.',
        duration: 5,
        aspectRatio: '16:9',
        generateAudio: true,
      },
    })

    expect(result).toMatchObject({
      endpoint: 'fal-ai/kling-video/o3/pro/image-to-video',
      externalId: 'FAL:VIDEO:fal-ai/kling-video/o3/pro/image-to-video:req_kling_o3_pro_1',
    })
    const requests = server!.getRequests('POST', '/fal/fal-ai/kling-video/o3/pro/image-to-video')
    expect(requests).toHaveLength(1)
    expect(JSON.parse(requests[0]?.bodyText || '{}')).toEqual({
      image_url: 'https://example.com/start.png',
      prompt: 'Generate a polished cinematic shot.',
      aspect_ratio: '16:9',
      duration: '5',
      generate_audio: true,
    })
  })

  it('maps Kling O3 two reference images to start and end frames', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/fal/fal-ai/kling-video/o3/standard/image-to-video',
      mode: 'success',
      submitResponse: {
        status: 200,
        body: { request_id: 'req_kling_o3_reference_frames_1' },
      },
    })

    await executeFalVideoGeneration({
      userId: 'user-1',
      selection: {
        provider: 'fal',
        modelId: 'fal-ai/kling-video/o3/standard/image-to-video',
        modelKey: 'fal::fal-ai/kling-video/o3/standard/image-to-video',
        variantSubKind: 'official',
      },
      imageUrl: 'https://example.com/start.png',
      options: {
        prompt: 'Animate from the first reference into the second.',
        referenceImages: ['https://example.com/start.png', 'https://example.com/end.png'],
        duration: 5,
        aspectRatio: '16:9',
      },
    })

    const requests = server!.getRequests('POST', '/fal/fal-ai/kling-video/o3/standard/image-to-video')
    expect(requests).toHaveLength(1)
    expect(JSON.parse(requests[0]?.bodyText || '{}')).toEqual({
      image_url: 'https://example.com/start.png',
      prompt: 'Animate from the first reference into the second.',
      aspect_ratio: '16:9',
      duration: '5',
      end_image_url: 'https://example.com/end.png',
    })
  })

  it('fails explicitly when Kling O3 receives more than two reference images', async () => {
    await expect(executeFalVideoGeneration({
      userId: 'user-1',
      selection: {
        provider: 'fal',
        modelId: 'fal-ai/kling-video/o3/standard/image-to-video',
        modelKey: 'fal::fal-ai/kling-video/o3/standard/image-to-video',
        variantSubKind: 'official',
      },
      imageUrl: 'https://example.com/start.png',
      options: {
        prompt: 'Too many references for O3.',
        referenceImages: [
          'https://example.com/start.png',
          'https://example.com/middle.png',
          'https://example.com/end.png',
        ],
        duration: 5,
        aspectRatio: '16:9',
      },
    })).rejects.toThrow('FAL_VIDEO_OPTION_UNSUPPORTED: referenceImages>2')
  })

  it('preserves Kling v3 multi-reference images as elements instead of dropping them', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/fal/fal-ai/kling-video/v3/pro/image-to-video',
      mode: 'success',
      submitResponse: {
        status: 200,
        body: { request_id: 'req_kling_v3_elements_1' },
      },
    })

    const result = await executeFalVideoGeneration({
      userId: 'user-1',
      selection: {
        provider: 'fal',
        modelId: 'fal-ai/kling-video/v3/pro/image-to-video',
        modelKey: 'fal::fal-ai/kling-video/v3/pro/image-to-video',
        variantSubKind: 'official',
      },
      imageUrl: 'https://example.com/start.png',
      options: {
        prompt: 'Use @Element1 as the character and @Element2 as the prop.',
        referenceImages: [
          'https://example.com/start.png',
          'https://example.com/character.png',
          'https://example.com/prop.png',
        ],
        duration: 6,
        aspectRatio: '16:9',
      },
    })

    expect(result).toMatchObject({
      endpoint: 'fal-ai/kling-video/v3/pro/image-to-video',
      externalId: 'FAL:VIDEO:fal-ai/kling-video/v3/pro/image-to-video:req_kling_v3_elements_1',
    })
    const requests = server!.getRequests('POST', '/fal/fal-ai/kling-video/v3/pro/image-to-video')
    expect(requests).toHaveLength(1)
    expect(JSON.parse(requests[0]?.bodyText || '{}')).toEqual({
      start_image_url: 'https://example.com/start.png',
      prompt: 'Use @Element1 as the character and @Element2 as the prop.',
      aspect_ratio: '16:9',
      duration: '6',
      elements: [
        { frontal_image_url: 'https://example.com/character.png' },
        { frontal_image_url: 'https://example.com/prop.png' },
      ],
      generate_audio: false,
    })
  })

  it('preserves Kling v3 Standard multi-reference images as elements', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/fal/fal-ai/kling-video/v3/standard/image-to-video',
      mode: 'success',
      submitResponse: {
        status: 200,
        body: { request_id: 'req_kling_v3_standard_elements_1' },
      },
    })

    await executeFalVideoGeneration({
      userId: 'user-1',
      selection: {
        provider: 'fal',
        modelId: 'fal-ai/kling-video/v3/standard/image-to-video',
        modelKey: 'fal::fal-ai/kling-video/v3/standard/image-to-video',
        variantSubKind: 'official',
      },
      imageUrl: 'https://example.com/start.png',
      options: {
        prompt: 'Use @Element1 as the location reference.',
        referenceImages: ['https://example.com/location.png'],
        duration: 5,
        aspectRatio: '9:16',
      },
    })

    const requests = server!.getRequests('POST', '/fal/fal-ai/kling-video/v3/standard/image-to-video')
    expect(requests).toHaveLength(1)
    expect(JSON.parse(requests[0]?.bodyText || '{}')).toEqual({
      start_image_url: 'https://example.com/start.png',
      prompt: 'Use @Element1 as the location reference.',
      aspect_ratio: '9:16',
      duration: '5',
      elements: [
        { frontal_image_url: 'https://example.com/location.png' },
      ],
      generate_audio: false,
    })
  })
})
