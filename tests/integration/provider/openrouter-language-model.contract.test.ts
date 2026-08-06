import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateText } from 'ai'
import { createOpenRouterLanguageModel } from '@/lib/ai-providers/openrouter/language-model'
import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { startScenarioServer } from '../../helpers/fakes/scenario-server'

describe('provider contract - OpenRouter language model submission', () => {
  let server: Awaited<ReturnType<typeof startScenarioServer>> | null = null

  beforeEach(async () => {
    server = await startScenarioServer()
  })

  afterEach(async () => {
    await server?.close()
    server = null
  })

  function createModel() {
    return createOpenRouterLanguageModel({
      providerKey: 'openrouter',
      selection: {
        provider: 'openrouter',
        modelId: 'openai/gpt-5.6-terra',
        modelKey: 'openrouter::openai/gpt-5.6-terra',
      },
      providerConfig: {
        id: 'openrouter',
        name: 'OpenRouter',
        apiKey: 'openrouter-language-key',
        baseUrl: `${server!.baseUrl}/openrouter/api/v1`,
      },
      protocol: 'openrouter-chat',
      publicReasoningMode: 'none',
      executionMode: 'sync',
      reasoning: false,
      reasoningEffort: 'medium',
    })
  }

  it('marks a structured initial 4xx envelope as an explicit rejection', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/openrouter/api/v1/chat/completions',
      mode: 'fatal_error',
      submitResponse: {
        status: 400,
        body: {
          error: {
            message: 'Invalid tool schema.',
            type: 'invalid_request',
            code: 'invalid_request_error',
          },
        },
      },
    })

    await expect(generateText({
      model: createModel(),
      prompt: 'submit once',
      maxRetries: 0,
    })).rejects.toMatchObject({
      name: 'ProviderSubmissionError',
      code: 'PROVIDER_SUBMISSION_REJECTED',
      disposition: 'rejected',
      provider: 'openrouter',
      message: 'Invalid tool schema.',
    })

    expect(server!.getRequests('POST', '/openrouter/api/v1/chat/completions')).toHaveLength(1)
  })

  it('does not infer rejection from an unclassified status or malformed body', async () => {
    for (const submitResponse of [
      { status: 429, body: { error: { message: 'Rate limited.', type: 'rate_limit' } } },
      { status: 500, body: { error: { message: 'Upstream unavailable.', type: 'server_error' } } },
      { status: 400, body: { message: 'No structured error envelope.' } },
    ]) {
      server!.defineScenario({
        method: 'POST',
        path: '/openrouter/api/v1/chat/completions',
        mode: 'fatal_error',
        submitResponse,
      })

      try {
        await generateText({ model: createModel(), prompt: 'stay ambiguous', maxRetries: 0 })
        throw new Error('Expected the provider request to fail')
      } catch (error) {
        expect(error).not.toBeInstanceOf(ProviderSubmissionError)
      }
      expect(server!.getRequests('POST', '/openrouter/api/v1/chat/completions')).toHaveLength(1)
    }
  })
})
