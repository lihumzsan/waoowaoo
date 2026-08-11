import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateText } from 'ai'
import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { arkImageGeneration } from '@/lib/ai-providers/ark/image'
import { createArkLanguageModel } from '@/lib/ai-providers/ark/language-model'
import {
  arkCreateVideoTask,
  type ArkVideoTaskRequest,
} from '@/lib/ai-providers/ark/video'
import { ProviderHttpError } from '@/lib/ai-providers/failure'
import { startScenarioServer } from '../../helpers/fakes/scenario-server'

const videoRequest: ArkVideoTaskRequest = {
  model: 'doubao-seedance-2-0-fast-260128',
  content: [{ type: 'text', text: 'test request' }],
}

describe('provider contract - Ark submission disposition', () => {
  let server: Awaited<ReturnType<typeof startScenarioServer>> | null = null

  beforeEach(async () => {
    server = await startScenarioServer()
  })

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('types Ark machine codes and structured client rejections as rejected submissions', async () => {
    const cases = [
      {
        id: 'billing',
        status: 403,
        body: { error: { code: 'AccountOverdueError', message: 'Account requires payment' } },
        code: 'PROVIDER_BILLING_REQUIRED',
      },
      {
        id: 'model',
        status: 404,
        body: { error: { code: 'ModelNotOpen', message: 'Model is not enabled' } },
        code: 'MODEL_NOT_OPEN',
      },
      {
        id: 'validation',
        status: 400,
        body: { error: { code: 'InvalidParameter', message: 'duration is invalid' } },
        code: 'PROVIDER_SUBMISSION_REJECTED',
      },
    ] as const

    for (const testCase of cases) {
      server!.defineScenario({
        method: 'POST',
        path: `/ark-${testCase.id}/contents/generations/tasks`,
        mode: 'fatal_error',
        submitResponse: { status: testCase.status, body: testCase.body },
      })

      await expect(arkCreateVideoTask(videoRequest, {
        apiKey: 'ark-key',
        baseUrl: `${server!.baseUrl}/ark-${testCase.id}`,
      })).rejects.toMatchObject({
        name: 'ProviderSubmissionError',
        code: testCase.code,
        disposition: 'rejected',
        failure: {
          native: { name: 'ProviderHttpError', statusCode: testCase.status },
          interpretation: { details: { httpStatus: testCase.status } },
          frames: [{ system: 'provider', provider: 'ark', phase: 'submit' }],
          recovery: { operation: 'provider.submit', taskReplay: 'forbidden' },
        },
      })
    }
  })

  it('does not infer rejection from HTTP 429, 5xx, or 2xx responses without an id or URL', async () => {
    for (const status of [429, 503] as const) {
      server!.defineScenario({
        method: 'POST',
        path: `/ark-${String(status)}/contents/generations/tasks`,
        mode: 'fatal_error',
        submitResponse: { status, body: { message: 'request failed' } },
      })
      let captured: unknown = null
      try {
        await arkCreateVideoTask(videoRequest, {
          apiKey: 'ark-key',
          baseUrl: `${server!.baseUrl}/ark-${String(status)}`,
        })
      } catch (error) {
        captured = error
      }
      expect(captured).toBeInstanceOf(ProviderHttpError)
      expect(captured).toMatchObject({ statusCode: status })
      expect(captured).not.toBeInstanceOf(ProviderSubmissionError)
    }

    server!.defineScenario({
      method: 'POST',
      path: '/ark-missing/contents/generations/tasks',
      mode: 'malformed_response',
      submitResponse: { status: 200, body: { status: 'queued' } },
    })
    await expect(arkCreateVideoTask(videoRequest, {
      apiKey: 'ark-key',
      baseUrl: `${server!.baseUrl}/ark-missing`,
    })).resolves.toMatchObject({ id: '' })

    server!.defineScenario({
      method: 'POST',
      path: '/ark-image/images/generations',
      mode: 'malformed_response',
      submitResponse: { status: 200, body: { data: [] } },
    })
    await expect(arkImageGeneration({ model: 'seedream-test', prompt: 'test' }, {
      apiKey: 'ark-key',
      baseUrl: `${server!.baseUrl}/ark-image`,
    })).resolves.toEqual({ data: [] })
  })

  it('preserves the Ark rejection through the language-model SDK initial HTTP boundary', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/ark-language/responses',
      mode: 'fatal_error',
      submitResponse: {
        status: 400,
        body: { error: { code: 'InvalidParameter', message: 'prompt is invalid' } },
      },
    })
    const model = createArkLanguageModel({
      providerKey: 'ark',
      selection: {
        provider: 'ark',
        modelId: 'doubao-seed-2-0-lite-260215',
        modelKey: 'ark::doubao-seed-2-0-lite-260215',
      },
      providerConfig: {
        id: 'ark',
        name: 'Ark',
        apiKey: 'ark-key',
        baseUrl: `${server!.baseUrl}/ark-language`,
      },
      protocol: 'openai-responses',
      publicReasoningMode: 'none',
      executionMode: 'sync',
      reasoning: false,
      reasoningEffort: 'medium',
    })

    await expect(generateText({ model, prompt: 'hello', maxRetries: 0 })).rejects.toMatchObject({
      name: 'ProviderSubmissionError',
      code: 'PROVIDER_SUBMISSION_REJECTED',
      disposition: 'rejected',
    })
  })
})
