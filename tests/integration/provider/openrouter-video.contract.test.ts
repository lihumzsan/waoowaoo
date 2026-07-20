import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { submitOpenRouterVideoTask } from '@/lib/ai-providers/openrouter/video'
import { startScenarioServer } from '../../helpers/fakes/scenario-server'

describe('provider contract - OpenRouter video', () => {
  let server: Awaited<ReturnType<typeof startScenarioServer>> | null = null

  beforeEach(async () => {
    server = await startScenarioServer()
  })

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('does not retry an uncertain SDK video submission', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/openrouter/videos',
      mode: 'retryable_error_then_success',
      submitResponse: { status: 503, body: { error: 'upstream unavailable' } },
      pollSequence: [{
        status: 202,
        body: {
          id: 'must-not-be-reached',
          status: 'pending',
          polling_url: `${server!.baseUrl}/openrouter/videos/must-not-be-reached`,
        },
      }],
    })

    await expect(submitOpenRouterVideoTask({
      baseUrl: `${server!.baseUrl}/openrouter`,
      apiKey: 'openrouter-video-key',
      payload: {
        model: 'bytedance/seedance-2.0',
        prompt: 'submit exactly once',
        duration: 5,
        resolution: '720p',
        aspectRatio: '16:9',
      },
    })).rejects.toMatchObject({ statusCode: 503 })

    expect(server!.getRequests('POST', '/openrouter/videos')).toHaveLength(1)
  })

  it('preserves an accepted external id when the SDK rejects only the response shape', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/openrouter/videos',
      mode: 'malformed_response',
      submitResponse: {
        status: 202,
        body: {
          id: 'accepted-job-id',
          polling_url: '/openrouter/videos/accepted-job-id',
          status: 'pending',
          error: { message: 'non-contract warning shape' },
        },
      },
    })

    await expect(submitOpenRouterVideoTask({
      baseUrl: `${server!.baseUrl}/openrouter`,
      apiKey: 'openrouter-video-key',
      payload: {
        model: 'bytedance/seedance-2.0-fast',
        prompt: 'preserve the accepted provider identity',
        duration: 15,
        resolution: '720p',
        aspectRatio: '16:9',
      },
    })).resolves.toBe('accepted-job-id')

    expect(server!.getRequests('POST', '/openrouter/videos')).toHaveLength(1)
  })

  it('surfaces the typed provider rejection hidden by an SDK response validation error', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/openrouter/videos',
      mode: 'fatal_error',
      submitResponse: {
        status: 202,
        body: {
          error: {
            code: 400,
            message: 'Reference images must use directly downloadable URLs',
            metadata: { error_type: 'invalid_request' },
          },
        },
      },
    })

    await expect(submitOpenRouterVideoTask({
      baseUrl: `${server!.baseUrl}/openrouter`,
      apiKey: 'openrouter-video-key',
      payload: {
        model: 'bytedance/seedance-2.0-fast',
        prompt: 'surface the provider rejection',
        duration: 15,
        resolution: '720p',
        aspectRatio: '16:9',
      },
    })).rejects.toMatchObject({
      name: 'FetchStatusError',
      status: 400,
      responseText: expect.stringContaining('type=invalid_request'),
      message: expect.stringContaining('Reference images must use directly downloadable URLs'),
    })

    expect(server!.getRequests('POST', '/openrouter/videos')).toHaveLength(1)
  })

  it('does not turn an unclassified accepted response into a safe-to-retry rejection', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/openrouter/videos',
      mode: 'malformed_response',
      submitResponse: {
        status: 202,
        body: { id: 'possibly-accepted-job', status: 'pending' },
      },
    })

    await expect(submitOpenRouterVideoTask({
      baseUrl: `${server!.baseUrl}/openrouter`,
      apiKey: 'openrouter-video-key',
      payload: {
        model: 'bytedance/seedance-2.0-fast',
        prompt: 'keep an ambiguous submission outcome fenced',
        duration: 15,
        resolution: '720p',
        aspectRatio: '16:9',
      },
    })).rejects.toMatchObject({
      name: 'Error',
      message: 'OPENROUTER_VIDEO_SUBMIT_RESPONSE_INVALID_WITHOUT_ACCEPTANCE_ID_OR_ERROR',
    })

    expect(server!.getRequests('POST', '/openrouter/videos')).toHaveLength(1)
  })
})
