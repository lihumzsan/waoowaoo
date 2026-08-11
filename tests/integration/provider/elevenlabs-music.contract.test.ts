import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeElevenLabsMusicGeneration } from '@/lib/ai-providers/elevenlabs/music'
import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { ProviderHttpError } from '@/lib/ai-providers/failure'
import { startScenarioServer } from '../../helpers/fakes/scenario-server'

const getProviderConfigMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/user-api/runtime-config', () => ({
  getProviderConfig: getProviderConfigMock,
}))

const ELEVENLABS_SELECTION = {
  provider: 'elevenlabs',
  modelId: 'music_v2',
  modelKey: 'elevenlabs::music_v2',
  variantSubKind: 'official',
} as const

const COMPOSITION_PLAN = {
  chunks: [
    {
      text: '[Restrained Tension]',
      durationMs: 3_000,
      positiveStyles: ['cinematic underscore', 'low strings'],
      negativeStyles: ['vocals', 'trailer hits'],
      contextAdherence: 'high' as const,
    },
    {
      text: '[Unresolved Release]',
      durationMs: 4_000,
      positiveStyles: ['fragile glass harmonics'],
      negativeStyles: ['triumphant cadence'],
      contextAdherence: 'high' as const,
    },
  ],
}

function executionInput() {
  return {
    userId: 'user-1',
    selection: ELEVENLABS_SELECTION,
    generation: { kind: 'composition_plan' as const, compositionPlan: COMPOSITION_PLAN },
    options: { outputFormat: 'mp3' as const },
  }
}

/**
 * Critical Provider Contract
 * Authority: ElevenLabs Music v2 REST schema and the production adapter.
 * Fault seam: only the external HTTP server is replaced.
 * Final oracle: exact snake_case Composition Plan wire body, binary audio,
 * stable typed pre-accept rejections, and outcome-unknown rate-limit/5xx semantics.
 */
describe('provider contract - ElevenLabs Music v2', () => {
  let server: Awaited<ReturnType<typeof startScenarioServer>> | null = null

  beforeEach(async () => {
    server = await startScenarioServer()
    getProviderConfigMock.mockResolvedValue({
      id: 'elevenlabs',
      name: 'ElevenLabs',
      apiKey: 'elevenlabs-key',
      baseUrl: server.baseUrl,
    })
  })

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('sends one exact Composition Plan and returns the binary audio', async () => {
    const audio = Buffer.from('fake-mp3-audio')
    server!.defineScenario({
      method: 'POST',
      path: '/v1/music',
      mode: 'success',
      submitResponse: {
        status: 200,
        headers: { 'content-type': 'audio/mpeg', 'song-id': 'song-1' },
        body: audio,
      },
    })

    await expect(executeElevenLabsMusicGeneration(executionInput())).resolves.toMatchObject({
      success: true,
      audioBase64: audio.toString('base64'),
      audioMimeType: 'audio/mpeg',
      requestId: 'song-1',
      metadata: { songId: 'song-1' },
    })

    const [request] = server!.getRequests('POST', '/v1/music')
    expect(request?.query).toBe('?output_format=mp3_48000_192')
    expect(request?.headers['xi-api-key']).toBe('elevenlabs-key')
    expect(JSON.parse(request?.bodyText || '{}')).toEqual({
      model_id: 'music_v2',
      composition_plan: {
        chunks: [
          {
            text: '[Restrained Tension]',
            duration_ms: 3_000,
            positive_styles: ['cinematic underscore', 'low strings'],
            negative_styles: ['vocals', 'trailer hits'],
            context_adherence: 'high',
          },
          {
            text: '[Unresolved Release]',
            duration_ms: 4_000,
            positive_styles: ['fragile glass harmonics'],
            negative_styles: ['triumphant cadence'],
            context_adherence: 'high',
          },
        ],
      },
    })
  })

  it('preserves bad_composition_plan as a typed provider rejection', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/v1/music',
      mode: 'fatal_error',
      submitResponse: {
        status: 422,
        body: {
          detail: {
            status: 'bad_composition_plan',
            message: 'copyrighted style reference',
            data: { composition_plan_suggestion: { chunks: [] } },
          },
        },
      },
    })

    await expect(executeElevenLabsMusicGeneration(executionInput())).rejects.toMatchObject({
      code: 'PROVIDER_SUBMISSION_REJECTED',
      provider: 'elevenlabs',
      disposition: 'rejected',
      details: { httpStatus: 422, providerCode: 'bad_composition_plan' },
    })
  })

  it('maps explicit pre-accept rejections to stable unified codes', async () => {
    const cases = [
      { status: 401, code: 'PROVIDER_AUTH_INVALID' },
      { status: 402, code: 'PROVIDER_BILLING_REQUIRED' },
    ] as const
    for (const testCase of cases) {
      server!.defineScenario({
        method: 'POST',
        path: '/v1/music',
        mode: 'fatal_error',
        submitResponse: {
          status: testCase.status,
          body: { detail: { status: `status_${String(testCase.status)}` } },
        },
      })
      await expect(executeElevenLabsMusicGeneration(executionInput())).rejects.toMatchObject({
        code: testCase.code,
        provider: 'elevenlabs',
        disposition: 'rejected',
      })
    }
  })

  it.each([429, 503])('leaves HTTP %s submission outcome unknown to the durable fence', async (status) => {
    server!.defineScenario({
      method: 'POST',
      path: '/v1/music',
      mode: 'fatal_error',
      submitResponse: { status, body: { detail: { status: `status_${String(status)}` } } },
    })

    let captured: unknown = null
    try {
      await executeElevenLabsMusicGeneration(executionInput())
    } catch (error) {
      captured = error
    }
    expect(captured).toBeInstanceOf(ProviderHttpError)
    expect(captured).not.toBeInstanceOf(ProviderSubmissionError)
    expect(captured).toMatchObject({ statusCode: status })
  })

  it('does not treat a 2xx JSON body as generated audio', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/v1/music',
      mode: 'malformed_response',
      submitResponse: { status: 200, body: { status: 'queued' } },
    })

    await expect(executeElevenLabsMusicGeneration(executionInput())).rejects.toThrow(
      'ELEVENLABS_MUSIC_RESPONSE_CONTENT_TYPE_INVALID:application/json',
    )
  })
})
