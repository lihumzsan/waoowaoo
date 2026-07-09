import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeElevenLabsSoundEffectGeneration } from '@/lib/ai-providers/elevenlabs/sound-effect'
import { ELEVENLABS_SOUND_EFFECT_MODEL_ID } from '@/lib/ai-providers/elevenlabs/models'
import { startScenarioServer } from '../../helpers/fakes/scenario-server'

const getProviderConfigMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/user-api/runtime-config', () => ({
  getProviderConfig: getProviderConfigMock,
}))

describe('provider contract - elevenlabs sound effects', () => {
  let server: Awaited<ReturnType<typeof startScenarioServer>> | null = null

  beforeEach(async () => {
    vi.clearAllMocks()
    server = await startScenarioServer()
    getProviderConfigMock.mockResolvedValue({
      id: 'elevenlabs',
      name: 'ElevenLabs',
      apiKey: 'eleven-key',
      baseUrl: server.baseUrl,
    })
  })

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('submits looped duration-controlled sound generation requests and returns audio data', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/v1/sound-generation',
      mode: 'success',
      submitResponse: {
        status: 200,
        headers: {
          'content-type': 'audio/mpeg',
          'character-cost': '84',
        },
        body: Buffer.from('fake-mp3'),
      },
    })

    const result = await executeElevenLabsSoundEffectGeneration({
      userId: 'user-1',
      selection: {
        provider: 'elevenlabs',
        modelId: ELEVENLABS_SOUND_EFFECT_MODEL_ID,
        modelKey: `elevenlabs::${ELEVENLABS_SOUND_EFFECT_MODEL_ID}`,
        variantSubKind: 'official',
      },
      prompt: 'Seamless loop of steady rooftop wind, no music, no voices.',
      options: {
        loop: true,
        durationSeconds: 30,
        promptInfluence: 0.55,
        outputFormat: 'mp3_44100_128',
      },
    })

    expect(result).toEqual({
      success: true,
      audioBase64: Buffer.from('fake-mp3').toString('base64'),
      audioMimeType: 'audio/mpeg',
      audioUrl: `data:audio/mpeg;base64,${Buffer.from('fake-mp3').toString('base64')}`,
      metadata: {
        model: ELEVENLABS_SOUND_EFFECT_MODEL_ID,
        outputFormat: 'mp3_44100_128',
        characterCost: '84',
      },
    })
    const requests = server!.getRequests('POST', '/v1/sound-generation')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.query).toBe('?output_format=mp3_44100_128')
    expect(requests[0]?.headers['xi-api-key']).toBe('eleven-key')
    expect(JSON.parse(requests[0]?.bodyText || '{}')).toEqual({
      text: 'Seamless loop of steady rooftop wind, no music, no voices.',
      model_id: ELEVENLABS_SOUND_EFFECT_MODEL_ID,
      loop: true,
      duration_seconds: 30,
      prompt_influence: 0.55,
    })
  })

  it('fails invalid sound effect durations before making a provider request', async () => {
    await expect(executeElevenLabsSoundEffectGeneration({
      userId: 'user-1',
      selection: {
        provider: 'elevenlabs',
        modelId: ELEVENLABS_SOUND_EFFECT_MODEL_ID,
        modelKey: `elevenlabs::${ELEVENLABS_SOUND_EFFECT_MODEL_ID}`,
        variantSubKind: 'official',
      },
      prompt: 'Seamless loop of steady rooftop wind, no music, no voices.',
      options: {
        loop: true,
        durationSeconds: 31,
      },
    })).rejects.toThrow('ELEVENLABS_SOUND_EFFECT_DURATION_SECONDS_INVALID')

    expect(server!.getRequests('POST', '/v1/sound-generation')).toHaveLength(0)
  })
})
