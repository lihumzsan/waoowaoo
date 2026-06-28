import { beforeEach, describe, expect, it, vi } from 'vitest'

const codexClientMock = vi.hoisted(() => {
  class MockCodexExecError extends Error {
    code: string
    exitCode?: number | null
    signal?: NodeJS.Signals | null
    stdout?: string
    stderr?: string

    constructor(
      code: string,
      message: string,
      details?: {
        exitCode?: number | null
        signal?: NodeJS.Signals | null
        stdout?: string
        stderr?: string
      },
    ) {
      super(`${code}: ${message}`)
      this.name = 'CodexExecError'
      this.code = code
      this.exitCode = details?.exitCode
      this.signal = details?.signal
      this.stdout = details?.stdout
      this.stderr = details?.stderr
    }
  }

  return {
    CodexExecError: MockCodexExecError,
    runCodexSelfCheck: vi.fn(),
  }
})

vi.mock('@/lib/ai-providers/codex/client', () => codexClientMock)

import { testProviderConnection } from '@/lib/ai-exec/provider-test'

describe('provider test connection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    codexClientMock.runCodexSelfCheck.mockReset()
  })

  it('passes Codex local CLI self-check without an API key', async () => {
    codexClientMock.runCodexSelfCheck.mockResolvedValueOnce({
      text: 'CODEX_OK',
      stdout: '',
      stderr: '',
      durationMs: 1234,
    })

    const result = await testProviderConnection({
      apiType: 'codex',
      apiKey: '',
      baseUrl: '%USERPROFILE%\\.codex\\.sandbox-bin\\codex.exe',
      llmModel: 'gpt-5.4',
    })

    expect(result.success).toBe(true)
    expect(codexClientMock.runCodexSelfCheck).toHaveBeenCalledWith({
      codexPath: '%USERPROFILE%\\.codex\\.sandbox-bin\\codex.exe',
      model: 'gpt-5.4',
    })
    expect(result.steps).toEqual([{
      name: 'textGen',
      status: 'pass',
      model: 'gpt-5.4',
      message: 'Codex CLI OK (1s): CODEX_OK',
      detail: 'Local Codex CLI self-check; no API key or routekey used.',
    }])
  })

  it('surfaces Codex timeout as a local CLI failure instead of an API key failure', async () => {
    codexClientMock.runCodexSelfCheck.mockRejectedValueOnce(
      new codexClientMock.CodexExecError('CODEX_EXEC_TIMEOUT', 'timed out', {
        exitCode: null,
        stdout: 'partial stdout',
        stderr: 'partial stderr',
      }),
    )

    const result = await testProviderConnection({
      apiType: 'codex',
      apiKey: '',
      llmModel: 'gpt-5.4',
    })

    expect(result.success).toBe(false)
    expect(result.steps[0]).toEqual({
      name: 'textGen',
      status: 'fail',
      model: 'gpt-5.4',
      message: 'Codex CLI timed out. The local Codex process may be busy or stuck.',
      detail: 'code=CODEX_EXEC_TIMEOUT | exitCode=null | stdout=partial stdout | stderr=partial stderr',
    })
  })
})
