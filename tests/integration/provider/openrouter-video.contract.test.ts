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
})
