import { beforeEach, describe, expect, it, vi } from 'vitest'

const runCodexSelfCheckMock = vi.hoisted(() => vi.fn(async () => ({
  text: 'CODEX_OK',
  stdout: '',
  stderr: '',
  durationMs: 12,
})))

vi.mock('@/lib/ai-providers/codex/client', () => ({
  runCodexSelfCheck: runCodexSelfCheckMock,
}))

import { testLlmConnection } from '@/lib/ai-exec/llm-test-connection'

describe('llm connection test', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('checks Codex local CLI without requiring an API key', async () => {
    const result = await testLlmConnection({
      provider: 'codex',
      baseUrl: '/usr/local/bin/codex',
      model: 'gpt-5.5',
    })

    expect(result).toEqual({
      provider: 'codex',
      message: 'codex connection ok',
      model: 'gpt-5.5',
      answer: 'CODEX_OK',
    })
    expect(runCodexSelfCheckMock).toHaveBeenCalledWith({
      codexPath: '/usr/local/bin/codex',
      model: 'gpt-5.5',
      timeoutMs: 60_000,
    })
  })

  it('keeps API keys required for remote LLM providers', async () => {
    await expect(testLlmConnection({
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    })).rejects.toThrow('Missing apiKey')
  })
})
