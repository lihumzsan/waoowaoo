import { describe, expect, it } from 'vitest'
import { normalizeCodexProviderRequest } from '@/lib/codex-model-gateway/proxy'

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
})
