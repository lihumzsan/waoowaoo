import type { LanguageModelV3, LanguageModelV3FunctionTool } from '@ai-sdk/provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runCodexTextCompletionMock = vi.hoisted(() => vi.fn(async () => ({
  text: '{"type":"tool_call","toolName":"get_project_phase","input":{"detail":"full"}}',
  stdout: '',
  stderr: '',
})))
const prepareCodexImageInputsMock = vi.hoisted(() => vi.fn())
const runCodexImageGenerationMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/ai-providers/codex/client', () => ({
  prepareCodexImageInputs: prepareCodexImageInputsMock,
  runCodexImageGeneration: runCodexImageGenerationMock,
  runCodexTextCompletion: runCodexTextCompletionMock,
}))

import { codexAdapter } from '@/lib/ai-providers/codex/adapter'

const projectPhaseTool: LanguageModelV3FunctionTool = {
  type: 'function',
  name: 'get_project_phase',
  description: 'Read the current project phase.',
  inputSchema: {
    type: 'object',
    properties: {
      detail: { type: 'string' },
    },
    required: ['detail'],
    additionalProperties: false,
  },
}

describe('provider contract - codex tool-call protocol', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runCodexTextCompletionMock.mockResolvedValue({
      text: '{"type":"tool_call","toolName":"get_project_phase","input":{"detail":"full"}}',
      stdout: '',
      stderr: '',
    })
  })

  it('exposes AI SDK tool calls from structured Codex output', async () => {
    const adapter = codexAdapter.languageModel
    if (!adapter) throw new Error('CODEX_LANGUAGE_MODEL_MISSING')

    const model = adapter.create({
      providerKey: 'codex',
      selection: {
        provider: 'codex',
        modelId: 'gpt-5.5',
        modelKey: 'codex::gpt-5.5',
      },
      providerConfig: {
        id: 'codex',
        name: 'Codex Local',
        apiKey: '',
        baseUrl: '/opt/codex',
      },
    }) as unknown as LanguageModelV3

    const result = await model.doGenerate({
      prompt: [
        { role: 'system', content: 'Use tools before answering.' },
        { role: 'user', content: [{ type: 'text', text: 'What phase is this project in?' }] },
      ],
      tools: [projectPhaseTool],
      toolChoice: { type: 'required' },
    })

    expect(result.warnings).toEqual([])
    expect(result.finishReason).toEqual({ unified: 'tool-calls', raw: 'tool_calls' })
    expect(result.content).toEqual([
      expect.objectContaining({
        type: 'tool-call',
        toolName: 'get_project_phase',
        input: '{"detail":"full"}',
      }),
    ])
    expect(runCodexTextCompletionMock).toHaveBeenCalledWith({
      codexPath: '/opt/codex',
      model: 'gpt-5.5',
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('Codex tool-call protocol'),
        }),
      ]),
    })
  })
})
