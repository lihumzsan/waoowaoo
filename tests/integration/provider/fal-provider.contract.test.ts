import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { falAsyncTaskProvider } from '@/lib/ai-providers/fal/async-task'
import { queryFalStatus, submitFalTask } from '@/lib/ai-providers/fal/queue'
import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { ProviderHttpError } from '@/lib/ai-providers/failure'
import { startScenarioServer } from '../../helpers/fakes/scenario-server'

describe('provider contract - fal queue', () => {
  let server: Awaited<ReturnType<typeof startScenarioServer>> | null = null

  beforeEach(async () => {
    server = await startScenarioServer()
    process.env.FAL_QUEUE_BASE_URL = `${server.baseUrl}/fal`
  })

  afterEach(async () => {
    delete process.env.FAL_QUEUE_BASE_URL
    await server?.close()
    server = null
  })

  it('submits the expected auth header and json payload', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/fal/fal-ai/nano-banana-pro',
      mode: 'success',
      submitResponse: {
        status: 200,
        body: { request_id: 'req_image_1' },
      },
    })

    const requestId = await submitFalTask(
      'fal-ai/nano-banana-pro',
      {
        prompt: 'generate image',
        image_urls: ['data:image/png;base64,AAAA'],
      },
      'fal-key-1',
    )

    expect(requestId).toBe('req_image_1')
    const requests = server!.getRequests('POST', '/fal/fal-ai/nano-banana-pro')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.headers.authorization).toBe('Key fal-key-1')
    expect(requests[0]?.headers['content-type']).toBe('application/json')
    expect(JSON.parse(requests[0]?.bodyText || '{}')).toEqual({
      prompt: 'generate image',
      image_urls: ['data:image/png;base64,AAAA'],
    })
  })

  it('does not retry an uncertain provider POST when the submit response is an error', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/fal/fal-ai/nano-banana-pro',
      mode: 'retryable_error_then_success',
      submitResponse: {
        status: 503,
        body: { error: 'upstream unavailable' },
      },
      pollSequence: [
        { status: 200, body: { request_id: 'req_image_retry_1' } },
      ],
    })

    let captured: unknown = null
    try {
      await submitFalTask(
        'fal-ai/nano-banana-pro',
        { prompt: 'retry submit' },
        'fal-key-retry',
      )
    } catch (error) {
      captured = error
    }

    expect(captured).toBeInstanceOf(ProviderHttpError)
    expect(captured).not.toBeInstanceOf(ProviderSubmissionError)
    expect(captured).toMatchObject({ statusCode: 503 })

    const requests = server!.getRequests('POST', '/fal/fal-ai/nano-banana-pro')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.headers.authorization).toBe('Key fal-key-retry')
  })

  it('types only structured provider machine rejections at submit time', async () => {
    const cases = [
      {
        id: 'validation',
        status: 422,
        body: { detail: [{ type: 'missing', msg: 'Field required' }] },
        code: 'PROVIDER_SUBMISSION_REJECTED',
        providerCode: 'missing',
      },
      {
        id: 'policy',
        status: 422,
        body: { detail: [{ type: 'content_policy_violation', msg: 'Reference rejected' }] },
        code: 'SENSITIVE_CONTENT',
        providerCode: 'content_policy_violation',
      },
      {
        id: 'auth',
        status: 401,
        body: { error: { code: 'invalid_api_key', message: 'Invalid API key' } },
        code: 'PROVIDER_AUTH_INVALID',
        providerCode: 'invalid_api_key',
      },
      {
        id: 'billing',
        status: 402,
        body: { error: { code: 'insufficient_balance', message: 'Balance exhausted' } },
        code: 'PROVIDER_BILLING_REQUIRED',
        providerCode: 'insufficient_balance',
      },
    ] as const

    for (const testCase of cases) {
      const endpoint = `fal-ai/submit-${testCase.id}`
      server!.defineScenario({
        method: 'POST',
        path: `/fal/${endpoint}`,
        mode: 'fatal_error',
        submitResponse: { status: testCase.status, body: testCase.body },
      })

      await expect(submitFalTask(endpoint, { prompt: 'submit once' }, 'fal-key')).rejects.toMatchObject({
        code: testCase.code,
        disposition: 'rejected',
        failure: {
          native: { name: 'ProviderHttpError', statusCode: testCase.status },
          interpretation: { details: {
            providerCode: testCase.providerCode,
            httpStatus: testCase.status,
          } },
          frames: [{ system: 'provider', provider: 'fal', phase: 'submit' }],
          recovery: { operation: 'provider.submit', taskReplay: 'forbidden' },
        },
      })
      expect(server!.getRequests('POST', `/fal/${endpoint}`)).toHaveLength(1)
    }
  })

  it('does not infer a submission disposition from HTTP 429 or 5xx alone', async () => {
    for (const status of [429, 503] as const) {
      const endpoint = `fal-ai/http-${String(status)}`
      server!.defineScenario({
        method: 'POST',
        path: `/fal/${endpoint}`,
        mode: 'fatal_error',
        submitResponse: { status, body: { message: 'request failed without a machine code' } },
      })

      let captured: unknown = null
      try {
        await submitFalTask(endpoint, { prompt: 'submit once' }, 'fal-key')
      } catch (error) {
        captured = error
      }
      expect(captured).toBeInstanceOf(ProviderHttpError)
      expect(captured).not.toBeInstanceOf(ProviderSubmissionError)
      expect(captured).toMatchObject({ statusCode: status })
    }
  })

  it('throws transient status failure so the worker poll loop can retry explicitly', async () => {
    server!.defineScenario({
      method: 'GET',
      path: '/fal/fal-ai/veo3.1/requests/req_video_1/status',
      mode: 'retryable_error_then_success',
      pollSequence: [
        { status: 503, body: { error: 'upstream unavailable' } },
        { status: 200, body: { status: 'COMPLETED' } },
      ],
    })
    server!.defineScenario({
      method: 'GET',
      path: '/fal/fal-ai/veo3.1/fast/image-to-video/requests/req_video_1',
      mode: 'success',
      submitResponse: {
        status: 200,
        body: {
          video: { url: 'https://cdn.local/video.mp4' },
        },
      },
    })

    await expect(
      queryFalStatus('fal-ai/veo3.1/fast/image-to-video', 'req_video_1', 'fal-key-2'),
    ).rejects.toMatchObject({
      statusCode: 503,
    })

    const second = await queryFalStatus('fal-ai/veo3.1/fast/image-to-video', 'req_video_1', 'fal-key-2')
    expect(second).toEqual({
      status: 'COMPLETED',
      completed: true,
      failed: false,
      resultUrl: 'https://cdn.local/video.mp4',
    })
  })

  it('throws FAL status 500 as a transient poll failure instead of returning a failed terminal result', async () => {
    server!.defineScenario({
      method: 'GET',
      path: '/fal/fal-ai/veo3.1/requests/req_status_500/status',
      mode: 'fatal_error',
      submitResponse: {
        status: 500,
        body: {
          detail: [{ type: 'downstream_service_error' }],
        },
      },
    })

    let capturedError: unknown = null
    try {
      await queryFalStatus('fal-ai/veo3.1/fast/image-to-video', 'req_status_500', 'fal-key-500')
    } catch (error) {
      capturedError = error
    }

    expect(capturedError).toMatchObject({
      statusCode: 500,
      errorEnvelope: { detail: [{ type: 'downstream_service_error' }] },
    })
    expect(capturedError).toBeInstanceOf(Error)
    expect((capturedError as Error).message).toBe('downstream_service_error')
  })

  it('marks a failed status response as failed with explicit provider error', async () => {
    server!.defineScenario({
      method: 'GET',
      path: '/fal/fal-ai/veo3.1/requests/req_failed/status',
      mode: 'fatal_error',
      submitResponse: {
        status: 200,
        body: {
          status: 'FAILED',
          error: 'content moderation failed',
        },
      },
    })

    const result = await queryFalStatus('fal-ai/veo3.1/fast/image-to-video', 'req_failed', 'fal-key-3')
    expect(result).toMatchObject({
      status: 'FAILED',
      completed: false,
      failed: true,
      failure: {
        native: { message: 'content moderation failed' },
        interpretation: { code: 'SENSITIVE_CONTENT' },
        recovery: { taskReplay: 'forbidden' },
      },
    })
  })

  it('maps a FAL failed status to an async provider failed result instead of pending', async () => {
    server!.defineScenario({
      method: 'GET',
      path: '/fal/openai/gpt-image-2/requests/req_no_balance/status',
      mode: 'fatal_error',
      submitResponse: {
        status: 200,
        body: {
          status: 'FAILED',
          error: 'insufficient balance',
        },
      },
    })

    const parsed = falAsyncTaskProvider.parseExternalId('FAL:IMAGE:openai/gpt-image-2:req_no_balance')
    const result = await falAsyncTaskProvider.poll({
      parsed,
      context: {
        userId: 'user-1',
        getProviderConfig: async () => ({
          id: 'fal',
          name: 'fal',
          provider: 'fal',
          apiKey: 'fal-key-no-balance',
          baseUrl: undefined,
          enabled: true,
          models: [],
        }),
        getUserModels: async () => [],
      },
    })

    expect(result).toMatchObject({
      status: 'failed',
      resultUrl: undefined,
      imageUrl: undefined,
      videoUrl: undefined,
      failure: {
        native: { message: 'insufficient balance' },
        interpretation: { code: 'PROVIDER_BILLING_REQUIRED' },
        recovery: { taskReplay: 'forbidden' },
      },
    })
  })

  it('fails explicitly for each malformed request id shape', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/fal/fal-ai/nano-banana-pro',
      mode: 'malformed_response',
      submitResponse: {
        status: 200,
        body: { ok: true },
      },
      pollSequence: [
        { status: 200, body: { request_id: 42 } },
        { status: 200, body: { request_id: '' } },
      ],
    })

    for (let index = 0; index < 3; index += 1) {
      await expect(
        submitFalTask('fal-ai/nano-banana-pro', { prompt: 'bad response' }, 'fal-key-4'),
      ).rejects.toThrow('FAL_SUBMIT_RESPONSE_REQUEST_ID_MISSING')
    }
  })

  it('treats completed result without media url as failed', async () => {
    server!.defineScenario({
      method: 'GET',
      path: '/fal/fal-ai/nano-banana-pro/requests/req_no_media/status',
      mode: 'queued_then_success',
      submitResponse: {
        status: 200,
        body: { status: 'COMPLETED' },
      },
    })
    server!.defineScenario({
      method: 'GET',
      path: '/fal/fal-ai/nano-banana-pro/requests/req_no_media',
      mode: 'malformed_response',
      submitResponse: {
        status: 200,
        body: { images: [] },
      },
    })

    const result = await queryFalStatus('fal-ai/nano-banana-pro', 'req_no_media', 'fal-key-5')
    expect(result).toMatchObject({
      status: 'COMPLETED',
      completed: true,
      failed: true,
      failure: {
        native: { message: 'FAL任务完成但未返回媒体URL' },
        interpretation: { code: 'EMPTY_RESPONSE' },
        recovery: { operation: 'provider.terminal.result', taskReplay: 'forbidden' },
      },
    })
  })
})
