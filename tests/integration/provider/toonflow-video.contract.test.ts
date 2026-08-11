import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  executeToonflowVideoGeneration,
  queryToonflowVideoStatus,
  submitToonflowVideoTask,
} from '@/lib/ai-providers/toonflow/video'
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
      imageUrl: '',
      options: {
        prompt: 'A slow cinematic push through a rain-soaked station.',
        referenceImages: ['https://example.com/character.png'],
        referenceAudios: ['https://example.com/voice.wav'],
        referenceVideos: ['https://example.com/motion.mp4'],
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
            image_url: { url: 'https://example.com/character.png' },
            role: 'reference_image',
          },
          {
            type: 'audio_url',
            audio_url: { url: 'https://example.com/voice.wav' },
            role: 'reference_audio',
          },
          {
            type: 'video_url',
            video_url: { url: 'https://example.com/motion.mp4' },
            role: 'reference_video',
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

  it('preserves the production balance rejection as a typed billing failure without resubmitting', async () => {
    const providerMessage = '余额不足，当前余额不足以完成本次生成'
    server!.defineScenario({
      method: 'POST',
      path: '/toonflow/video/generateVideo',
      mode: 'fatal_error',
      submitResponse: {
        status: 400,
        body: { code: 400, message: providerMessage },
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
    })).rejects.toMatchObject({
      code: 'PROVIDER_BILLING_REQUIRED',
      failure: {
        native: {
          name: 'FetchStatusError',
          message: expect.stringContaining(providerMessage),
          statusCode: 400,
        },
        interpretation: {
          code: 'PROVIDER_BILLING_REQUIRED',
          details: {
            providerCode: 400,
            httpStatus: 400,
          },
        },
        frames: [{ system: 'provider', provider: 'toonflow', phase: 'submit' }],
        recovery: { operation: 'provider.submit', taskReplay: 'forbidden' },
      },
    })

    expect(server!.getRequests('POST', '/toonflow/video/generateVideo')).toHaveLength(1)
  })

  it('keeps an unknown provider rejection neutral while preserving bounded diagnostics', async () => {
    const providerMessage = `policy rejected ${'x'.repeat(600)}`
    server!.defineScenario({
      method: 'POST',
      path: '/toonflow/video/generateVideo',
      mode: 'fatal_error',
      submitResponse: {
        status: 200,
        body: { code: 400, msg: providerMessage },
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
    })).rejects.toMatchObject({
      code: 'PROVIDER_SUBMISSION_REJECTED',
      failure: {
        native: {
          name: 'ProviderSubmissionError',
          message: providerMessage.slice(0, 512),
        },
        interpretation: { code: 'PROVIDER_SUBMISSION_REJECTED' },
        context: {
          system: 'provider',
          provider: 'toonflow',
          phase: 'submit',
          operation: 'provider.submit',
        },
        recovery: { operation: 'provider.submit', taskReplay: 'forbidden' },
      },
    })

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

  it('projects a post-accept copyright failure to a safe canonical rights error', async () => {
    const providerFailReason =
      'The request failed because the output video may be related to copyright restrictions.'
    server!.defineScenario({
      method: 'POST',
      path: '/toonflow/video/getVideoStatus',
      mode: 'fatal_error',
      submitResponse: {
        status: 200,
        body: {
          code: 200,
          message: '成功',
          data: {
            id: 'cgt-task-rights-789',
            status: 'failed',
            failReason: providerFailReason,
          },
        },
      },
    })

    const result = await queryToonflowVideoStatus({
      baseUrl: `${server!.baseUrl}/toonflow`,
      apiKey: 'toonflow-video-key',
      taskCode: 'cgt-task-rights-789',
    })

    expect(result).toMatchObject({
      status: 'failed',
      failure: {
        native: {
          name: 'ProviderTerminalResult',
          message: providerFailReason,
          cause: { message: '成功' },
        },
        interpretation: { code: 'CONTENT_RIGHTS_RESTRICTION' },
        recovery: { taskReplay: 'forbidden' },
      },
    })
    expect(JSON.stringify(result)).toContain(providerFailReason)
    expect(server!.getRequests('POST', '/toonflow/video/getVideoStatus')).toHaveLength(1)
  })
})
