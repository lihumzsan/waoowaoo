import { beforeEach, describe, expect, it, vi } from 'vitest'
import { testProviderConnection } from '@/lib/user-api/provider-test'

const listComfyUiWorkflowKeysMock = vi.hoisted(() =>
  vi.fn(() => ['baseimage/图片生成/Flux2Klein文生图']),
)

const hasComfyUiWorkflowKeyMock = vi.hoisted(() =>
  vi.fn((workflowKey: string) => workflowKey === 'baseimage/图片生成/Flux2Klein文生图'),
)

vi.mock('@/lib/providers/comfyui/workflow-registry', () => ({
  COMFYUI_DEFAULT_IMAGE_WORKFLOW_ID: 'baseimage/图片生成/Flux2Klein文生图',
  hasComfyUiWorkflowKey: hasComfyUiWorkflowKeyMock,
  listComfyUiWorkflowKeys: listComfyUiWorkflowKeysMock,
}))

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

vi.mock('@/lib/providers/codex/client', () => codexClientMock)

const fetchMock = vi.hoisted(() =>
  vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)

    if (url.includes('/queue')) {
      return new Response(JSON.stringify({ queue_running: [] }), { status: 200 })
    }

    if (url.includes('dashscope.aliyuncs.com/compatible-mode/v1/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'qwen-plus' }] }), { status: 200 })
    }

    if (url.includes('coding.dashscope.aliyuncs.com/v1/models')) {
      return new Response('not-found', { status: 404 })
    }

    if (url.includes('coding.dashscope.aliyuncs.com/v1/chat/completions')) {
      const payload = typeof init?.body === 'string'
        ? JSON.parse(init.body) as { model?: string }
        : {}

      if (payload.model === 'invalid-model') {
        return new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 400 })
      }

      if (payload.model === 'qwen3.5-plus' || payload.model === 'glm-5' || payload.model === 'kimi-k2.5') {
        return new Response(JSON.stringify({
          choices: [{ message: { content: 'pong' } }],
        }), { status: 200 })
      }

      return new Response('not-found', { status: 404 })
    }

    if (url.includes('api.siliconflow.cn/v1/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'Qwen/Qwen3-32B' }] }), { status: 200 })
    }

    if (url.includes('api.siliconflow.cn/v1/user/info')) {
      return new Response(JSON.stringify({ data: { balance: '12.3000' } }), { status: 200 })
    }

    return new Response('not-found', { status: 404 })
  }),
)

describe('provider test connection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    codexClientMock.runCodexSelfCheck.mockReset()
    listComfyUiWorkflowKeysMock.mockReturnValue(['baseimage/图片生成/Flux2Klein文生图'])
    hasComfyUiWorkflowKeyMock.mockImplementation(
      (workflowKey: string) => workflowKey === 'baseimage/图片生成/Flux2Klein文生图',
    )
  })

  it('passes bailian probe with models step and credits skip', async () => {
    const result = await testProviderConnection({
      apiType: 'bailian',
      apiKey: 'bl-key',
    })

    expect(result.success).toBe(true)
    expect(result.steps).toEqual([
      {
        name: 'models',
        status: 'pass',
        message: 'Found 1 models',
        model: 'qwen-plus',
      },
      {
        name: 'credits',
        status: 'skip',
        message: 'Not supported by Bailian probe API',
      },
    ])
  })

  it('probes bailian coding plans via text generation instead of models list', async () => {
    const result = await testProviderConnection({
      apiType: 'bailian',
      apiKey: 'sk-sp-demo',
    })

    expect(result.success).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://coding.dashscope.aliyuncs.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-sp-demo',
          'Content-Type': 'application/json',
        }),
      }),
    )
    expect(result.steps).toEqual([
      {
        name: 'textGen',
        status: 'pass',
        model: 'qwen3.5-plus',
        message: 'Response: pong',
      },
      {
        name: 'credits',
        status: 'skip',
        message: 'Not supported by Bailian probe API',
      },
    ])
  })

  it('falls back from an invalid preferred coding plan model to a supported preset model', async () => {
    const result = await testProviderConnection({
      apiType: 'bailian',
      apiKey: 'sk-sp-demo',
      llmModel: 'invalid-model',
    })

    expect(result.success).toBe(true)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://coding.dashscope.aliyuncs.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"model":"invalid-model"'),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://coding.dashscope.aliyuncs.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"model":"qwen3.5-plus"'),
      }),
    )
    expect(result.steps[0]).toEqual({
      name: 'textGen',
      status: 'pass',
      model: 'qwen3.5-plus',
      message: 'Response: pong',
    })
  })

  it('passes siliconflow probe with models and credits steps', async () => {
    const result = await testProviderConnection({
      apiType: 'siliconflow',
      apiKey: 'sf-key',
    })

    expect(result.success).toBe(true)
    expect(result.steps[0]).toEqual({
      name: 'models',
      status: 'pass',
      message: 'Found 1 models',
    })
    expect(result.steps[1]).toEqual({
      name: 'credits',
      status: 'pass',
      message: 'Balance: 12.3000',
    })
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

  it('classifies auth failures for bailian models probe', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('unauthorized', { status: 401 }))

    const result = await testProviderConnection({
      apiType: 'bailian',
      apiKey: 'bad-key',
    })

    expect(result.success).toBe(false)
    expect(result.steps[0]).toEqual({
      name: 'models',
      status: 'fail',
      message: 'Authentication failed (401)',
      detail: 'unauthorized',
    })
    expect(result.steps[1]).toEqual({
      name: 'credits',
      status: 'skip',
      message: 'Not supported by Bailian probe API',
    })
  })

  it('classifies rate limit failures for siliconflow models probe', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('rate limit', { status: 429 }))

    const result = await testProviderConnection({
      apiType: 'siliconflow',
      apiKey: 'sf-key',
    })

    expect(result.success).toBe(false)
    expect(result.steps[0]).toEqual({
      name: 'models',
      status: 'fail',
      message: 'Rate limited (429)',
      detail: 'rate limit',
    })
    expect(result.steps[1]).toEqual({
      name: 'credits',
      status: 'skip',
      message: 'Skipped because model probe failed',
    })
  })

  it('classifies network failures for siliconflow user info probe', async () => {
    fetchMock.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ data: [{ id: 'Qwen/Qwen3-32B' }] }), { status: 200 }),
    )
    fetchMock.mockImplementationOnce(async () => {
      throw new Error('socket hang up')
    })

    const result = await testProviderConnection({
      apiType: 'siliconflow',
      apiKey: 'sf-key',
    })

    expect(result.success).toBe(false)
    expect(result.steps[0]).toEqual({
      name: 'models',
      status: 'pass',
      message: 'Found 1 models',
    })
    expect(result.steps[1]).toEqual({
      name: 'credits',
      status: 'fail',
      message: 'Network error: socket hang up',
    })
  })

  it('passes ComfyUI probe when the server and default workflow are both available', async () => {
    const result = await testProviderConnection({
      apiType: 'comfyui',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:8188',
    })

    expect(result.success).toBe(true)
    expect(result.steps).toEqual([
      {
        name: 'models',
        status: 'pass',
        message: 'ComfyUI server reachable (/queue)',
      },
      {
        name: 'imageGen',
        status: 'pass',
        message: 'Found 1 local workflows',
        detail: 'baseimage/图片生成/Flux2Klein文生图',
      },
    ])
  })

  it('fails ComfyUI probe when no local workflow files are registered', async () => {
    listComfyUiWorkflowKeysMock.mockReturnValue([])
    hasComfyUiWorkflowKeyMock.mockReturnValue(false)

    const result = await testProviderConnection({
      apiType: 'comfyui',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:8188',
    })

    expect(result.success).toBe(false)
    expect(result.steps).toEqual([
      {
        name: 'models',
        status: 'pass',
        message: 'ComfyUI server reachable (/queue)',
      },
      {
        name: 'imageGen',
        status: 'fail',
        message: 'No local ComfyUI workflows found',
        detail: 'Set COMFYUI_WORKFLOW_ROOT or restore src/lib/providers/comfyui/workflows. Expected workflow: baseimage/图片生成/Flux2Klein文生图.json',
      },
    ])
  })
})
