import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeMurekaMusicGeneration } from '@/lib/ai-providers/mureka/music'
import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { FetchStatusError } from '@/lib/retry'
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

    const prompt = 'restrained industrial ambience'
    await expect(executeMurekaMusicGeneration({
      userId: 'user-1',
      selection: MUREKA_SELECTION,
      prompt,
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

    const requests = server!.getRequests('POST', '/v1/instrumental/generate')
    expect(requests).toHaveLength(1)
    expect(JSON.parse(requests[0]?.bodyText || '{}')).toMatchObject({ prompt })
  })

  it('preserves a structured authentication machine code as a typed rejection', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/v1/instrumental/generate',
      mode: 'fatal_error',
      submitResponse: {
        status: 401,
        body: {
          error: { code: 'unauthorized', message: 'Invalid Authentication' },
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
      disposition: 'rejected',
    })

    expect(server!.getRequests('POST', '/v1/instrumental/generate')).toHaveLength(1)
  })

  it('maps structured submit machine codes without guessing from HTTP status', async () => {
    const cases = [
      { machineCode: 'insufficient_balance', code: 'PROVIDER_BILLING_REQUIRED', disposition: 'rejected' },
      { machineCode: 'sensitive_content', code: 'SENSITIVE_CONTENT', disposition: 'rejected' },
      { machineCode: 'invalid_request', code: 'PROVIDER_SUBMISSION_REJECTED', disposition: 'rejected' },
      { machineCode: 'rate_limit_exceeded', code: 'RATE_LIMIT', disposition: 'rejected' },
    ] as const

    for (const testCase of cases) {
      server!.defineScenario({
        method: 'POST',
        path: '/v1/instrumental/generate',
        mode: 'fatal_error',
        submitResponse: {
          status: testCase.machineCode === 'rate_limit_exceeded' ? 429 : 400,
          body: { error: { code: testCase.machineCode, message: `machine:${testCase.machineCode}` } },
        },
      })

      await expect(executeMurekaMusicGeneration({
        userId: 'user-1',
        selection: MUREKA_SELECTION,
        prompt: 'restrained industrial ambience',
        options: { durationSeconds: 60, vocalMode: 'instrumental', outputFormat: 'mp3' },
      })).rejects.toMatchObject({
        code: testCase.code,
        disposition: testCase.disposition,
        provider: 'mureka',
        failure: {
          native: { name: 'FetchStatusError' },
          interpretation: { details: { providerCode: testCase.machineCode } },
          frames: [{ system: 'provider', provider: 'mureka', phase: 'submit' }],
          recovery: { operation: 'provider.submit', taskReplay: 'forbidden' },
        },
      })
    }
  })

  it('keeps status-only submission failures outcome-unknown to the durable fence', async () => {
    for (const status of [401, 429, 503] as const) {
      server!.defineScenario({
        method: 'POST',
        path: '/v1/instrumental/generate',
        mode: 'fatal_error',
        submitResponse: { status, body: { message: 'status without a machine code' } },
      })

      let captured: unknown = null
      try {
        await executeMurekaMusicGeneration({
          userId: 'user-1',
          selection: MUREKA_SELECTION,
          prompt: 'restrained industrial ambience',
          options: { durationSeconds: 60, vocalMode: 'instrumental', outputFormat: 'mp3' },
        })
      } catch (error) {
        captured = error
      }
      expect(captured).toBeInstanceOf(FetchStatusError)
      expect(captured).not.toBeInstanceOf(ProviderSubmissionError)
      expect(captured).toMatchObject({ status })
    }
  })

  it('keeps a 2xx response without a task id outcome-unknown to the durable fence', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/v1/instrumental/generate',
      mode: 'malformed_response',
      submitResponse: { status: 200, body: { status: 'preparing' } },
    })

    let captured: unknown = null
    try {
      await executeMurekaMusicGeneration({
        userId: 'user-1',
        selection: MUREKA_SELECTION,
        prompt: 'restrained industrial ambience',
        options: { durationSeconds: 60, vocalMode: 'instrumental', outputFormat: 'mp3' },
      })
    } catch (error) {
      captured = error
    }
    expect(captured).toBeInstanceOf(Error)
    expect(captured).not.toBeInstanceOf(ProviderSubmissionError)
    expect((captured as Error).message).toBe('MUREKA_INSTRUMENTAL_RESPONSE_TASK_ID_MISSING')
  })

  it('keeps a 2xx upload response without a file id outcome-unknown to the durable fence', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/v1/files/upload',
      mode: 'malformed_response',
      submitResponse: { status: 200, body: { status: 'uploaded' } },
    })

    let captured: unknown = null
    try {
      await executeMurekaMusicGeneration({
        userId: 'user-1',
        selection: MUREKA_SELECTION,
        prompt: 'restrained industrial ambience',
        options: {
          durationSeconds: 60,
          vocalMode: 'instrumental',
          outputFormat: 'mp3',
          referenceVideoUrl: 'https://media.example/video.mp4',
          referenceVideoDurationMs: 60_000,
        },
      })
    } catch (error) {
      captured = error
    }
    expect(captured).toBeInstanceOf(Error)
    expect(captured).not.toBeInstanceOf(ProviderSubmissionError)
    expect((captured as Error).message).toBe('MUREKA_UPLOAD_RESPONSE_FILE_ID_MISSING')
    expect(server!.getRequests('POST', '/v1/soundtrack/generate')).toHaveLength(0)
  })
})
