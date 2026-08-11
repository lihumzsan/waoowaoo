import { ApiError } from '@google/genai'
import { describe, expect, it } from 'vitest'
import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { validateGoogleLanguageModelResult } from '@/lib/ai-providers/google/language-model'
import {
  assertGoogleSubmissionResponse,
  captureGoogleSdkSubmission,
  googleSafetyTerminalError,
} from '@/lib/ai-providers/google/submission'

describe('provider contract - Google submission disposition', () => {
  it('types only explicit SDK client rejection statuses', async () => {
    const cases = [
      { status: 400, code: 'PROVIDER_SUBMISSION_REJECTED' },
      { status: 401, code: 'PROVIDER_AUTH_INVALID' },
      { status: 403, code: 'PROVIDER_AUTH_INVALID' },
      { status: 404, code: 'MODEL_NOT_OPEN' },
    ] as const
    for (const testCase of cases) {
      await expect(captureGoogleSdkSubmission(async () => {
        throw new ApiError({ status: testCase.status, message: 'Google rejected the request' })
      })).rejects.toMatchObject({
        name: 'ProviderSubmissionError',
        code: testCase.code,
        disposition: 'rejected',
        failure: {
          native: { name: 'ApiError', statusCode: testCase.status },
          interpretation: { details: { httpStatus: testCase.status } },
          frames: [{ system: 'provider', provider: 'google', phase: 'submit' }],
          recovery: { operation: 'provider.submit', taskReplay: 'forbidden' },
        },
      })
    }
  })

  it('does not infer a disposition from SDK 429, 5xx, or transport errors', async () => {
    for (const error of [
      new ApiError({ status: 429, message: 'rate limited' }),
      new ApiError({ status: 503, message: 'unavailable' }),
      new TypeError('socket disconnected'),
    ]) {
      let captured: unknown = null
      try {
        await captureGoogleSdkSubmission(async () => {
          throw error
        })
      } catch (failure) {
        captured = failure
      }
      expect(captured).toBe(error)
      expect(captured).not.toBeInstanceOf(ProviderSubmissionError)
    }
  })

  it('requires the standard Google error body at the language-model HTTP boundary', async () => {
    await expect(assertGoogleSubmissionResponse(new Response(JSON.stringify({
      error: { code: 400, status: 'INVALID_ARGUMENT', message: 'prompt is invalid' },
    }), { status: 400 }))).rejects.toMatchObject({
      name: 'ProviderSubmissionError',
      code: 'PROVIDER_SUBMISSION_REJECTED',
      disposition: 'rejected',
    })

    await expect(assertGoogleSubmissionResponse(new Response(JSON.stringify({
      message: 'bare client error',
    }), { status: 400 }))).rejects.toMatchObject({
      name: 'ProviderHttpError',
      statusCode: 400,
      errorEnvelope: { message: 'bare client error' },
    })
    await expect(assertGoogleSubmissionResponse(new Response(JSON.stringify({
      error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'rate limited' },
    }), { status: 429 }))).resolves.toBeUndefined()
    await expect(assertGoogleSubmissionResponse(new Response(JSON.stringify({
      error: { code: 503, status: 'UNAVAILABLE', message: 'unavailable' },
    }), { status: 503 }))).resolves.toBeUndefined()
  })

  it('treats an explicit 2xx safety finish as a rejected terminal result', () => {
    expect(googleSafetyTerminalError('SAFETY', {
      name: 'GoogleTerminalResult',
      message: 'blocked',
      code: 'SAFETY',
    })).toMatchObject({
      name: 'ProviderSubmissionError',
      code: 'SENSITIVE_CONTENT',
      disposition: 'rejected',
    })
    expect(() => validateGoogleLanguageModelResult({
      schemaVersion: 1,
      provider: 'google',
      modelId: 'gemini-test',
      text: '',
      reasoning: '',
      usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 },
      response: {},
      termination: { kind: 'safety', rawReason: 'SAFETY' },
    }, { executionMode: 'stream' })).toThrow(ProviderSubmissionError)
  })
})
