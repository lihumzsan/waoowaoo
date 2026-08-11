import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProviderHttpError } from '@/lib/ai-providers/failure'
import { queryFalStatus, submitFalTask } from '@/lib/ai-providers/fal/queue'
import { startScenarioServer } from '../../helpers/fakes/scenario-server'
import type { FakeResponseSpec } from '../../helpers/fakes/scenario-server'

describe('provider contract - fal queue result and failure boundaries', () => {
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

  it('rejects missing credentials before any provider request', async () => {
    await expect(submitFalTask('fal-ai/model', {}, '')).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_INVALID',
    })
    await expect(queryFalStatus('fal-ai/model', 'request-1', '')).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_INVALID',
    })
    expect(server!.getRequests('POST', '/fal/fal-ai/model')).toEqual([])
    expect(server!.getRequests('GET', '/fal/fal-ai/model/requests/request-1/status')).toEqual([])
  })

  it('rejects incomplete endpoints and unknown provider statuses explicitly', async () => {
    await expect(queryFalStatus('fal-ai', 'request-1', 'key')).rejects.toThrow('FAL_ENDPOINT_INVALID:fal-ai')

    server!.defineScenario({
      method: 'GET',
      path: '/fal/fal-ai/model/requests/request-unknown/status',
      mode: 'malformed_response',
      submitResponse: { status: 200, body: { status: 'CANCELLED' } },
    })
    await expect(queryFalStatus('fal-ai/model', 'request-unknown', 'key')).rejects.toThrow(
      'FAL_STATUS_UNKNOWN:CANCELLED',
    )
  })

  it('preserves both non-terminal queue states and authenticated status request shape', async () => {
    for (const status of ['IN_QUEUE', 'IN_PROGRESS'] as const) {
      const requestId = `request-${status.toLowerCase()}`
      const path = `/fal/fal-ai/model/requests/${requestId}/status`
      server!.defineScenario({
        method: 'GET',
        path,
        mode: 'success',
        submitResponse: { status: 200, body: { status } },
      })

      await expect(queryFalStatus('fal-ai/model/variant', requestId, 'queue-key')).resolves.toEqual({
        status,
        completed: false,
        failed: false,
      })
      const requests = server!.getRequests('GET', path)
      expect(requests).toHaveLength(1)
      expect(requests[0]?.headers.authorization).toBe('Key queue-key')
      expect(requests[0]?.query).toBe('?logs=0')
    }
  })

  it('uses an explicit response_url and validates result request headers', async () => {
    const resultUrl = `${server!.baseUrl}/custom-result`
    server!.defineScenario({
      method: 'GET',
      path: '/fal/fal-ai/model/requests/request-response-url/status',
      mode: 'success',
      submitResponse: { status: 200, body: { status: 'COMPLETED', response_url: resultUrl } },
    })
    server!.defineScenario({
      method: 'GET',
      path: '/custom-result',
      mode: 'success',
      submitResponse: { status: 200, body: { audio: { url: 'https://cdn.local/audio.mp3' } } },
    })

    await expect(queryFalStatus('fal-ai/model/variant', 'request-response-url', 'result-key')).resolves.toEqual({
      status: 'COMPLETED',
      completed: true,
      failed: false,
      resultUrl: 'https://cdn.local/audio.mp3',
    })
    const requests = server!.getRequests('GET', '/custom-result')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.headers.authorization).toBe('Key result-key')
    expect(requests[0]?.headers.accept).toBe('application/json')
  })

  it('reads video, audio, and first-image media results without guessing malformed values', async () => {
    const cases: ReadonlyArray<{
      readonly id: string
      readonly body: FakeResponseSpec['body']
      readonly headers?: Record<string, string>
      readonly expected: string | null
    }> = [
      { id: 'video', body: { video: { url: 'https://cdn.local/video.mp4' } }, expected: 'https://cdn.local/video.mp4' },
      { id: 'audio', body: { video: { url: 4 }, audio: { url: 'https://cdn.local/audio.mp3' } }, expected: 'https://cdn.local/audio.mp3' },
      { id: 'image', body: { audio: { url: null }, images: [{ url: 'https://cdn.local/image.png' }] }, expected: 'https://cdn.local/image.png' },
      { id: 'empty-video', body: { video: { url: '' }, audio: { url: 'https://cdn.local/fallback.mp3' } }, expected: 'https://cdn.local/fallback.mp3' },
      { id: 'null-result', body: null, expected: null },
      {
        id: 'string-result',
        body: JSON.stringify('not-an-object'),
        headers: { 'content-type': 'application/json' },
        expected: null,
      },
    ]

    for (const testCase of cases) {
      server!.defineScenario({
        method: 'GET',
        path: `/fal/fal-ai/model/requests/request-${testCase.id}/status`,
        mode: 'success',
        submitResponse: { status: 200, body: { status: 'COMPLETED' } },
      })
      server!.defineScenario({
        method: 'GET',
        path: `/fal/fal-ai/model/requests/request-${testCase.id}`,
        mode: 'success',
        submitResponse: { status: 200, body: testCase.body, headers: testCase.headers },
      })
      const result = await queryFalStatus('fal-ai/model', `request-${testCase.id}`, 'key')
      if (testCase.expected) {
        expect(result).toEqual({
          status: 'COMPLETED', completed: true, failed: false, resultUrl: testCase.expected,
        })
      } else {
        expect(result).toMatchObject({
          status: 'COMPLETED', completed: true, failed: true,
          failure: {
            native: { message: 'FAL任务完成但未返回媒体URL' },
            interpretation: { code: 'EMPTY_RESPONSE' },
            recovery: { operation: 'provider.terminal.result', taskReplay: 'forbidden' },
          },
        })
      }
    }
  })

  it('maps each 422 result error shape to an explicit failed terminal result', async () => {
    const cases: ReadonlyArray<{
      readonly id: string
      readonly body: FakeResponseSpec['body']
      readonly error: string
    }> = [
      {
        id: 'policy',
        body: { detail: [{ type: 'content_policy_violation' }] },
        error: '⚠️ 内容审核未通过：生成结果被拦截',
      },
      { id: 'typed', body: { detail: [{ type: 'input_rejected' }] }, error: 'FAL 错误: input_rejected' },
      { id: 'no-detail', body: {}, error: '无法获取结果' },
      { id: 'null-json', body: null, error: '无法获取结果' },
      { id: 'array-json', body: [], error: '无法获取结果' },
      { id: 'non-array-detail', body: { detail: 'invalid' }, error: '无法获取结果' },
      { id: 'indexed-object-detail', body: { detail: { 0: { type: 'not-an-array' } } }, error: '无法获取结果' },
      { id: 'missing', body: { detail: [] }, error: '无法获取结果' },
      { id: 'null-entry', body: { detail: [null] }, error: '无法获取结果' },
      { id: 'array-entry', body: { detail: [[]] }, error: '无法获取结果' },
      { id: 'empty-type', body: { detail: [{ type: '' }] }, error: '无法获取结果' },
      { id: 'numeric-type', body: { detail: [{ type: 7 }] }, error: '无法获取结果' },
      { id: 'malformed', body: 'not-json', error: '无法获取结果' },
    ]

    for (const testCase of cases) {
      server!.defineScenario({
        method: 'GET',
        path: `/fal/fal-ai/model/requests/request-${testCase.id}/status`,
        mode: 'success',
        submitResponse: { status: 200, body: { status: 'COMPLETED' } },
      })
      server!.defineScenario({
        method: 'GET',
        path: `/fal/fal-ai/model/requests/request-${testCase.id}`,
        mode: 'fatal_error',
        submitResponse: { status: 422, body: testCase.body },
      })
      await expect(queryFalStatus('fal-ai/model', `request-${testCase.id}`, 'key')).resolves.toMatchObject({
        status: 'COMPLETED',
        completed: true,
        failed: true,
        failure: {
          native: { name: 'ProviderHttpError', statusCode: 422 },
          interpretation: {
            code: testCase.id === 'policy'
              ? 'SENSITIVE_CONTENT'
              : 'PROVIDER_SUBMISSION_REJECTED',
          },
          recovery: { taskReplay: 'forbidden' },
        },
      })
    }
  })

  it('classifies result 500 as retryable and preserves generic non-special failures', async () => {
    const cases = [
      {
        id: 'downstream',
        status: 500,
        body: { detail: [{ type: 'downstream_service_error' }] },
      },
      { id: 'generic-500', status: 500, body: 'not-json' },
      { id: 'conflict', status: 409, body: 'request conflict' },
    ] as const

    for (const testCase of cases) {
      server!.defineScenario({
        method: 'GET',
        path: `/fal/fal-ai/model/requests/request-${testCase.id}/status`,
        mode: 'success',
        submitResponse: { status: 200, body: { status: 'COMPLETED' } },
      })
      server!.defineScenario({
        method: 'GET',
        path: `/fal/fal-ai/model/requests/request-${testCase.id}`,
        mode: 'fatal_error',
        submitResponse: { status: testCase.status, body: testCase.body },
      })
      const promise = queryFalStatus('fal-ai/model', `request-${testCase.id}`, 'key')
      await expect(promise).rejects.toBeInstanceOf(ProviderHttpError)
      await expect(promise).rejects.toMatchObject({
        statusCode: testCase.status,
        errorEnvelope: testCase.body,
      })
    }
  })

  it('uses the explicit failed-status fallback for absent or blank provider errors', async () => {
    for (const [id, error] of [['missing', undefined], ['blank', '   '], ['non-string', 42]] as const) {
      server!.defineScenario({
        method: 'GET',
        path: `/fal/fal-ai/model/requests/request-${id}/status`,
        mode: 'fatal_error',
        submitResponse: { status: 200, body: { status: 'FAILED', error } },
      })
      await expect(queryFalStatus('fal-ai/model', `request-${id}`, 'key')).resolves.toMatchObject({
        status: 'FAILED',
        completed: false,
        failed: true,
        failure: {
          native: { message: '任务失败' },
          interpretation: { code: 'EXTERNAL_ERROR' },
          recovery: { taskReplay: 'forbidden' },
        },
      })
    }
  })
})
