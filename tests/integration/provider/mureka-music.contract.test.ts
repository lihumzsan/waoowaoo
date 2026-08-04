import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeMurekaMusicGeneration } from '@/lib/ai-providers/mureka/music'
import { startScenarioServer } from '../../helpers/fakes/scenario-server'

const getProviderConfigMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/user-api/runtime-config', () => ({
  getProviderConfig: getProviderConfigMock,
}))

const MUREKA_SELECTION = {
  provider: 'mureka',
  modelId: 'mureka-9',
  modelKey: 'mureka::mureka-9',
  variantSubKind: 'official',
} as const

describe('provider contract - Mureka music', () => {
  let server: Awaited<ReturnType<typeof startScenarioServer>> | null = null

  beforeEach(async () => {
    server = await startScenarioServer()
    getProviderConfigMock.mockResolvedValue({
      id: 'mureka',
      name: 'mureka',
      apiKey: 'mureka-key',
      baseUrl: server.baseUrl,
    })
  })

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('accepts the documented asynchronous success shape without treating message as an error', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/v1/instrumental/generate',
      mode: 'success',
      submitResponse: {
        status: 200,
        body: {
          id: '1436211',
          status: 'preparing',
          message: 'queued',
          trace_id: 'trace-1',
        },
      },
    })

    await expect(executeMurekaMusicGeneration({
      userId: 'user-1',
      selection: MUREKA_SELECTION,
      prompt: 'restrained industrial ambience',
      options: {
        durationSeconds: 60,
        vocalMode: 'instrumental',
        outputFormat: 'mp3',
      },
    })).resolves.toMatchObject({
      success: true,
      async: true,
      requestId: '1436211',
      externalId: 'MUREKA:MUSIC:instrumental:1436211',
    })

    expect(server!.getRequests('POST', '/v1/instrumental/generate')).toHaveLength(1)
  })

  it('preserves the documented HTTP authentication error as a typed rejection', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/v1/instrumental/generate',
      mode: 'fatal_error',
      submitResponse: {
        status: 401,
        body: {
          error: { message: 'Invalid Authentication' },
          trace_id: 'trace-2',
        },
      },
    })

    await expect(executeMurekaMusicGeneration({
      userId: 'user-1',
      selection: MUREKA_SELECTION,
      prompt: 'restrained industrial ambience',
      options: {
        durationSeconds: 60,
        vocalMode: 'instrumental',
        outputFormat: 'mp3',
      },
    })).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_INVALID',
      provider: 'mureka',
    })

    expect(server!.getRequests('POST', '/v1/instrumental/generate')).toHaveLength(1)
  })
})
