import { describe, expect, it } from 'vitest'
import {
  normalizeCodexProviderRequest,
} from '@/lib/codex-model-gateway/proxy'
import { projectCodexProviderResponse } from '@/lib/codex-model-gateway/error-projection'

describe('Codex provider request normalization', () => {
  it('lifts interleaved developer messages while preserving model history order', () => {
    const request: Record<string, unknown> = {
      instructions: 'codex base',
      input: [
        {
          type: 'message',
          role: 'developer',
          content: [{ type: 'input_text', text: 'workspace contract' }],
        },
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'original request' }],
        },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'partial work' }],
        },
        {
          type: 'message',
          role: 'developer',
          content: [{ type: 'input_text', text: 'current permissions' }],
        },
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'continue' }],
        },
      ],
    }

    normalizeCodexProviderRequest(request)

    expect(request.instructions).toBe(
      'codex base\n\nworkspace contract\n\ncurrent permissions',
    )
    expect((request.input as Array<{ role: string }>).map((item) => item.role)).toEqual([
      'user',
      'assistant',
      'user',
    ])
  })

  it('rejects an instruction item that cannot be preserved exactly', () => {
    expect(() => normalizeCodexProviderRequest({
      input: [{
        type: 'message',
        role: 'developer',
        content: [{ type: 'output_text', text: 'invalid' }],
      }],
    })).toThrow('CODEX_MODEL_GATEWAY_REQUEST_INSTRUCTIONS_INVALID')
  })

  it.each([
    {
      providerStatus: 402,
      providerError: { type: 'payment_required', code: 'insufficient_credits' },
      expectedStatus: 429,
      expectedCode: 'usage_not_included',
      expectedKind: 'billing_required',
    },
    {
      providerStatus: 401,
      providerError: { type: 'authentication_error', code: 'invalid_api_key' },
      expectedStatus: 503,
      expectedCode: 'slow_down',
      expectedKind: 'configuration_unavailable',
    },
    {
      providerStatus: 422,
      providerError: { type: 'invalid_request_error', code: 'invalid_request' },
      expectedStatus: 503,
      expectedCode: 'slow_down',
      expectedKind: 'request_rejected',
    },
    {
      providerStatus: 503,
      providerError: { type: 'server_error', code: 'provider_down' },
      expectedStatus: 503,
      expectedCode: 'slow_down',
      expectedKind: 'temporarily_unavailable',
    },
    {
      providerStatus: 400,
      providerError: { type: 'invalid_request_error', code: 'content_policy_violation' },
      expectedStatus: 200,
      expectedCode: 'cyber_policy',
      expectedKind: 'policy_rejected',
    },
  ])('projects Provider $providerStatus into the official Codex error vocabulary', async ({
    providerStatus,
    providerError,
    expectedStatus,
    expectedCode,
    expectedKind,
  }) => {
    const projected = await projectCodexProviderResponse(Response.json({
      error: { ...providerError, message: 'provider-private-message' },
    }, { status: providerStatus }))

    expect(projected.failureKind).toBe(expectedKind)
    expect(projected.providerStatus).toBe(providerStatus)
    expect(projected.response.status).toBe(expectedStatus)
    expect(await projected.response.text()).toContain(`\"code\":\"${expectedCode}\"`)
  })

  it('preserves a Provider rate-limit response and its retry boundary', async () => {
    const projected = await projectCodexProviderResponse(Response.json({
      error: { type: 'rate_limit_error', code: 'rate_limit_exceeded' },
    }, {
      status: 429,
      headers: { 'Retry-After': '12' },
    }))

    expect(projected.failureKind).toBe('rate_limited')
    expect(projected.response.status).toBe(429)
    expect(projected.response.headers.get('retry-after')).toBe('12')
  })
})
