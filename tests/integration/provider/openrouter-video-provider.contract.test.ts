import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateAiOptions } from '@/lib/ai-exec/normalize'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { openRouterAdapter } from '@/lib/ai-providers/openrouter/adapter'
import {
  executeOpenRouterVideoGeneration,
  queryOpenRouterVideoStatus,
} from '@/lib/ai-providers/openrouter/video'
import { startScenarioServer } from '../../helpers/fakes/scenario-server'

const getProviderConfigMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/user-api/runtime-config', () => ({
  getProviderConfig: getProviderConfigMock,
}))

describe('provider contract - openrouter video', () => {
  let server: Awaited<ReturnType<typeof startScenarioServer>> | null = null

  beforeEach(async () => {
    vi.clearAllMocks()
    ensureAiCatalogsRegistered()
    server = await startScenarioServer()
    getProviderConfigMock.mockResolvedValue({
      id: 'openrouter',
      name: 'openrouter',
      apiKey: 'openrouter-key',
      baseUrl: `${server.baseUrl}/openrouter`,
    })
  })

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('submits Seedance 2.0 data URL first-frame requests to OpenRouter videos', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/openrouter/videos',
      mode: 'success',
      submitResponse: {
        status: 202,
        body: { id: 'job_seedance_i2v_1', status: 'pending' },
      },
    })

    const result = await executeOpenRouterVideoGeneration({
      userId: 'user-1',
      selection: {
        provider: 'openrouter',
        modelId: 'bytedance/seedance-2.0',
        modelKey: 'openrouter::bytedance/seedance-2.0',
        variantSubKind: 'official',
      },
      imageUrl: 'data:image/png;base64,AAAA',
      options: {
        prompt: 'A slow cinematic dolly in.',
        resolution: '720p',
        duration: 5,
        aspectRatio: '16:9',
        generateAudio: false,
      },
    })

    expect(result).toMatchObject({
      success: true,
      async: true,
      requestId: 'job_seedance_i2v_1',
      endpoint: 'videos',
      externalId: 'OPENROUTER:VIDEO:job_seedance_i2v_1',
    })

    const requests = server!.getRequests('POST', '/openrouter/videos')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.headers.authorization).toBe('Bearer openrouter-key')
    expect(JSON.parse(requests[0]?.bodyText || '{}')).toEqual({
      model: 'bytedance/seedance-2.0',
      prompt: 'A slow cinematic dolly in.',
      resolution: '720p',
      duration: 5,
      aspect_ratio: '16:9',
      generate_audio: false,
      frame_images: [
        {
          type: 'image_url',
          frame_type: 'first_frame',
          image_url: { url: 'data:image/png;base64,AAAA' },
        },
      ],
    })
  })

  it('submits Seedance 2.0 Fast first-last-frame requests as frame_images', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/openrouter/videos',
      mode: 'success',
      submitResponse: {
        status: 202,
        body: { id: 'job_seedance_fast_flf_1', status: 'pending' },
      },
    })

    const result = await executeOpenRouterVideoGeneration({
      userId: 'user-1',
      selection: {
        provider: 'openrouter',
        modelId: 'bytedance/seedance-2.0-fast',
        modelKey: 'openrouter::bytedance/seedance-2.0-fast',
        variantSubKind: 'official',
      },
      imageUrl: 'data:image/png;base64,FIRST',
      options: {
        prompt: 'Transition between the two exact frames.',
        resolution: '480p',
        duration: 4,
        aspectRatio: '9:21',
        generateAudio: true,
        lastFrameImageUrl: 'data:image/png;base64,LAST',
      },
    })

    expect(result.externalId).toBe('OPENROUTER:VIDEO:job_seedance_fast_flf_1')
    const requests = server!.getRequests('POST', '/openrouter/videos')
    expect(requests).toHaveLength(1)
    expect(JSON.parse(requests[0]?.bodyText || '{}')).toEqual({
      model: 'bytedance/seedance-2.0-fast',
      prompt: 'Transition between the two exact frames.',
      resolution: '480p',
      duration: 4,
      aspect_ratio: '9:21',
      generate_audio: true,
      frame_images: [
        {
          type: 'image_url',
          frame_type: 'first_frame',
          image_url: { url: 'data:image/png;base64,FIRST' },
        },
        {
          type: 'image_url',
          frame_type: 'last_frame',
          image_url: { url: 'data:image/png;base64,LAST' },
        },
      ],
    })
  })

  it('submits Seedance 2.0 multi-reference requests as input_references', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/openrouter/videos',
      mode: 'success',
      submitResponse: {
        status: 202,
        body: { id: 'job_seedance_ref_1', status: 'pending' },
      },
    })

    const result = await executeOpenRouterVideoGeneration({
      userId: 'user-1',
      selection: {
        provider: 'openrouter',
        modelId: 'bytedance/seedance-2.0',
        modelKey: 'openrouter::bytedance/seedance-2.0',
        variantSubKind: 'official',
      },
      imageUrl: 'data:image/png;base64,HERO',
      options: {
        prompt: 'Use the same hero and location references.',
        referenceImages: ['data:image/png;base64,HERO', 'data:image/png;base64,LOCATION'],
        resolution: '1080p',
        duration: 8,
        aspectRatio: '21:9',
        generateAudio: false,
      },
    })

    expect(result.externalId).toBe('OPENROUTER:VIDEO:job_seedance_ref_1')
    const requests = server!.getRequests('POST', '/openrouter/videos')
    expect(requests).toHaveLength(1)
    expect(JSON.parse(requests[0]?.bodyText || '{}')).toEqual({
      model: 'bytedance/seedance-2.0',
      prompt: 'Use the same hero and location references.',
      resolution: '1080p',
      duration: 8,
      aspect_ratio: '21:9',
      generate_audio: false,
      input_references: [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,HERO' } },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,LOCATION' } },
      ],
    })
  })

  it('rejects fal-only auto aspect ratio for OpenRouter Seedance 2.0', async () => {
    await expect(executeOpenRouterVideoGeneration({
      userId: 'user-1',
      selection: {
        provider: 'openrouter',
        modelId: 'bytedance/seedance-2.0',
        modelKey: 'openrouter::bytedance/seedance-2.0',
        variantSubKind: 'official',
      },
      imageUrl: 'data:image/png;base64,AAAA',
      options: {
        prompt: 'Invalid aspect ratio.',
        resolution: '720p',
        duration: 5,
        aspectRatio: 'auto',
      },
    })).rejects.toThrow('OPENROUTER_VIDEO_OPTION_VALUE_UNSUPPORTED: aspectRatio=auto')

    expect(server!.getRequests('POST', '/openrouter/videos')).toHaveLength(0)
  })

  it('exposes an option schema that accepts references and rejects auto aspect ratio', () => {
    const descriptor = openRouterAdapter.video?.describe({
      provider: 'openrouter',
      modelId: 'bytedance/seedance-2.0-fast',
      modelKey: 'openrouter::bytedance/seedance-2.0-fast',
      variantSubKind: 'official',
    })
    if (!descriptor) throw new Error('OPENROUTER_VIDEO_DESCRIPTOR_MISSING')

    expect(() => validateAiOptions({
      schema: descriptor.optionSchema,
      options: {
        prompt: 'Schema ok.',
        referenceImages: ['data:image/png;base64,AAAA'],
        resolution: '720p',
        duration: 4,
        aspectRatio: '9:21',
        generateAudio: false,
      },
      context: 'video:openrouter::bytedance/seedance-2.0-fast',
    })).not.toThrow()

    expect(() => validateAiOptions({
      schema: descriptor.optionSchema,
      options: {
        prompt: 'Schema rejects fal-only ratio.',
        resolution: '720p',
        duration: 4,
        aspectRatio: 'auto',
      },
      context: 'video:openrouter::bytedance/seedance-2.0-fast',
    })).toThrow('AI_OPTION_INVALID:video:openrouter::bytedance/seedance-2.0-fast:aspectRatio:unsupported_value=auto')
  })

  it('polls completed OpenRouter video jobs with scoped download authorization', async () => {
    const contentUrl = `${server!.baseUrl}/openrouter/videos/job_done/content?index=0`
    server!.defineScenario({
      method: 'GET',
      path: '/openrouter/videos/job_done',
      mode: 'success',
      submitResponse: {
        status: 200,
        body: {
          id: 'job_done',
          status: 'completed',
          unsigned_urls: [contentUrl],
        },
      },
    })

    const result = await queryOpenRouterVideoStatus({
      baseUrl: `${server!.baseUrl}/openrouter`,
      apiKey: 'openrouter-key',
      requestId: 'job_done',
    })

    expect(result).toEqual({
      status: 'completed',
      videoUrl: contentUrl,
      resultUrl: contentUrl,
      downloadHeaders: { Authorization: 'Bearer openrouter-key' },
    })

    const requests = server!.getRequests('GET', '/openrouter/videos/job_done')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.headers.authorization).toBe('Bearer openrouter-key')
  })
})
