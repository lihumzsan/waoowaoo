import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  executeToonflowVideoGeneration,
  queryToonflowVideoStatus,
  submitToonflowVideoTask,
} from '@/lib/ai-providers/toonflow/video'
import { ProviderPreAcceptRejectedError } from '@/lib/ai-exec/submission-error'
import { startScenarioServer } from '../../helpers/fakes/scenario-server'

const getProviderConfigMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/user-api/runtime-config', () => ({
  getProviderConfig: getProviderConfigMock,
}))

describe('provider contract - Toonflow video', () => {
  let server: Awaited<ReturnType<typeof startScenarioServer>> | null = null

  beforeEach(async () => {
    server = await startScenarioServer()
    getProviderConfigMock.mockResolvedValue({
      id: 'toonflow',
      name: 'toonflow',
      apiKey: 'toonflow-video-key',
      baseUrl: `${server.baseUrl}/toonflow`,
    })
  })

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('serializes the documented Seedance request and preserves the accepted task code', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/toonflow/video/generateVideo',
      mode: 'success',
      submitResponse: {
        status: 200,
        body: { code: 200, data: 'cgt-task-123' },
      },
    })

    await expect(executeToonflowVideoGeneration({
      userId: 'user-1',
      selection: {
        provider: 'toonflow',
        modelId: 'seedance-2.0',
        modelKey: 'toonflow::seedance-2.0',
        variantSubKind: 'official',
      },
      imageUrl: 'https://example.com/first.png',
      options: {
        prompt: 'A slow cinematic push through a rain-soaked station.',
        referenceImages: ['https://example.com/character.png'],
        referenceAudios: ['https://example.com/voice.wav'],
        duration: 4,
        resolution: '480p',
        aspectRatio: '16:9',
        generateAudio: false,
      },
    })).resolves.toMatchObject({
      success: true,
      async: true,
      requestId: 'cgt-task-123',
      externalId: 'TOONFLOW:VIDEO:cgt-task-123',
    })

    const requests = server!.getRequests('POST', '/toonflow/video/generateVideo')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.headers.authorization).toBe('Bearer toonflow-video-key')
    expect(JSON.parse(requests[0]?.bodyText || '{}')).toEqual({
      model: 'Seedance 2.0',
      prompt: 'A slow cinematic push through a rain-soaked station.',
      resolution: '480p',
      duration: 4,
      metadata: {
        ratio: '16:9',
        generate_audio: false,
        references: [
          {
            type: 'image_url',
            image_url: { url: 'https://example.com/first.png' },
            role: 'first_frame',
          },
          {
            type: 'image_url',
            image_url: { url: 'https://example.com/character.png' },
            role: 'reference_image',
          },
          {
            type: 'audio_url',
            audio_url: { url: 'https://example.com/voice.wav' },
            role: 'reference_audio',
          },
        ],
        watermark: false,
        seed: -1,
      },
    })
  })

  it('selects the Fast wire model without changing the submit lifecycle', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/toonflow/video/generateVideo',
      mode: 'success',
      submitResponse: {
        status: 200,
        body: { code: 200, data: 'cgt-fast-123' },
      },
    })

    await expect(executeToonflowVideoGeneration({
      userId: 'user-1',
      selection: {
        provider: 'toonflow',
        modelId: 'seedance-2.0-fast',
        modelKey: 'toonflow::seedance-2.0-fast',
        variantSubKind: 'official',
      },
      imageUrl: '',
      options: {
        prompt: 'A restrained cinematic orbital sunrise.',
        duration: 4,
        resolution: '480p',
        aspectRatio: '16:9',
        generateAudio: true,
      },
    })).resolves.toMatchObject({
      success: true,
      async: true,
      externalId: 'TOONFLOW:VIDEO:cgt-fast-123',
    })

    const requests = server!.getRequests('POST', '/toonflow/video/generateVideo')
    expect(requests).toHaveLength(1)
    expect(JSON.parse(requests[0]?.bodyText || '{}')).toMatchObject({
      model: 'Seedance 2.0 fast',
      resolution: '480p',
      duration: 4,
      metadata: {
        ratio: '16:9',
        generate_audio: true,
      },
    })
  })

  it('classifies a typed pre-accept billing rejection without retrying the provider', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/toonflow/video/generateVideo',
      mode: 'fatal_error',
      submitResponse: {
        status: 200,
        body: { code: 402, msg: 'balance unavailable' },
      },
    })

    await expect(submitToonflowVideoTask({
      baseUrl: `${server!.baseUrl}/toonflow`,
      apiKey: 'toonflow-video-key',
      payload: {
        model: 'Seedance 2.0',
        prompt: 'submit once',
        resolution: '480p',
        duration: 4,
        metadata: {
          ratio: '16:9',
          generate_audio: false,
          references: [],
          watermark: false,
          seed: -1,
        },
      },
    })).rejects.toBeInstanceOf(ProviderPreAcceptRejectedError)

    expect(server!.getRequests('POST', '/toonflow/video/generateVideo')).toHaveLength(1)
  })

  it('never resubmits an uncertain transport failure', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/toonflow/video/generateVideo',
      mode: 'fatal_error',
      submitResponse: { status: 503, body: { code: 503 } },
    })

    await expect(submitToonflowVideoTask({
      baseUrl: `${server!.baseUrl}/toonflow`,
      apiKey: 'toonflow-video-key',
      payload: {
        model: 'Seedance 2.0',
        prompt: 'submit once',
        resolution: '480p',
        duration: 4,
        metadata: {
          ratio: '16:9',
          generate_audio: false,
          references: [],
          watermark: false,
          seed: -1,
        },
      },
    })).rejects.toMatchObject({ code: 'EXTERNAL_ERROR' })

    expect(server!.getRequests('POST', '/toonflow/video/generateVideo')).toHaveLength(1)
  })

  it('polls by taskICode and accepts only the matching documented terminal', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/toonflow/video/getVideoStatus',
      mode: 'queued_then_success',
      pollSequence: [
        {
          status: 200,
          body: { code: 200, data: { id: 'cgt-task-456', status: 'running' } },
        },
        {
          status: 200,
          body: {
            code: 200,
            data: {
              id: 'cgt-task-456',
              status: 'success',
              data: 'https://cdn.example.com/result.mp4',
            },
          },
        },
      ],
    })

    await expect(queryToonflowVideoStatus({
      baseUrl: `${server!.baseUrl}/toonflow`,
      apiKey: 'toonflow-video-key',
      taskCode: 'cgt-task-456',
    })).resolves.toEqual({ status: 'pending' })
    await expect(queryToonflowVideoStatus({
      baseUrl: `${server!.baseUrl}/toonflow`,
      apiKey: 'toonflow-video-key',
      taskCode: 'cgt-task-456',
    })).resolves.toEqual({
      status: 'completed',
      videoUrl: 'https://cdn.example.com/result.mp4',
    })

    const requests = server!.getRequests('POST', '/toonflow/video/getVideoStatus')
    expect(requests).toHaveLength(2)
    expect(requests.map((request) => JSON.parse(request.bodyText))).toEqual([
      { taskICode: 'cgt-task-456' },
      { taskICode: 'cgt-task-456' },
    ])
  })
})
