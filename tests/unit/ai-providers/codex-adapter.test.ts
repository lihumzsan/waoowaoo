import { beforeEach, describe, expect, it, vi } from 'vitest'

const getProviderConfigMock = vi.hoisted(() => vi.fn(async () => ({
  id: 'codex',
  name: 'Codex Local',
  apiKey: '',
  baseUrl: '/usr/local/bin/codex',
})))
const cleanupMock = vi.hoisted(() => vi.fn(async () => undefined))
const prepareCodexImageInputsMock = vi.hoisted(() => vi.fn(async () => ({
  imagePaths: ['/tmp/ref-a.png', '/tmp/ref-b.png'],
  cleanup: cleanupMock,
})))
const runCodexImageGenerationMock = vi.hoisted(() => vi.fn(async () => ({
  imageBase64: 'UE5H',
  mimeType: 'image/png',
  imagePath: '/tmp/out.png',
  text: '{"image_path":"/tmp/out.png"}',
  stdout: '',
  stderr: '',
})))
const runCodexTextCompletionMock = vi.hoisted(() => vi.fn(async () => ({
  text: 'Codex response',
  stdout: '',
  stderr: '',
})))
const normalizeToBase64ForGenerationMock = vi.hoisted(() => vi.fn(async () => 'data:image/png;base64,QQ=='))

vi.mock('@/lib/user-api/runtime-config', () => ({
  getProviderConfig: getProviderConfigMock,
}))

vi.mock('@/lib/media/outbound-image', () => ({
  normalizeToBase64ForGeneration: normalizeToBase64ForGenerationMock,
}))

vi.mock('@/lib/ai-providers/codex/client', () => ({
  prepareCodexImageInputs: prepareCodexImageInputsMock,
  runCodexImageGeneration: runCodexImageGenerationMock,
  runCodexTextCompletion: runCodexTextCompletionMock,
}))

import { codexAdapter } from '@/lib/ai-providers/codex/adapter'
import {
  createCodexLanguageModel,
  runCodexLlmCompletion,
  runCodexLlmStream,
  runCodexVisionCompletion,
} from '@/lib/ai-providers/codex/llm'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import type { LanguageModelV3FunctionTool, LanguageModelV3StreamPart } from '@ai-sdk/provider'

type CodexTextCompletionInput = {
  codexPath: string
  model: string
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
}

const projectPhaseTool: LanguageModelV3FunctionTool = {
  type: 'function',
  name: 'get_project_phase',
  description: 'Read the project phase.',
  inputSchema: {
    type: 'object',
    properties: {
      detail: { type: 'string' },
    },
    required: ['detail'],
    additionalProperties: false,
  },
}

function createTestCodexLanguageModel() {
  return createCodexLanguageModel({
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
  })
}

async function readLanguageModelStreamParts(
  stream: ReadableStream<LanguageModelV3StreamPart>,
): Promise<LanguageModelV3StreamPart[]> {
  const reader = stream.getReader()
  const parts: LanguageModelV3StreamPart[] = []
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) return parts
      parts.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }
}

describe('codex provider adapter', () => {
  beforeEach(() => {
    ensureAiCatalogsRegistered()
    vi.clearAllMocks()
    getProviderConfigMock.mockResolvedValue({
      id: 'codex',
      name: 'Codex Local',
      apiKey: '',
      baseUrl: '/usr/local/bin/codex',
    })
    cleanupMock.mockResolvedValue(undefined)
    prepareCodexImageInputsMock.mockResolvedValue({
      imagePaths: ['/tmp/ref-a.png', '/tmp/ref-b.png'],
      cleanup: cleanupMock,
    })
    runCodexImageGenerationMock.mockResolvedValue({
      imageBase64: 'UE5H',
      mimeType: 'image/png',
      imagePath: '/tmp/out.png',
      text: '{"image_path":"/tmp/out.png"}',
      stdout: '',
      stderr: '',
    })
    runCodexTextCompletionMock.mockResolvedValue({
      text: 'Codex response',
      stdout: '',
      stderr: '',
    })
  })

  it('exposes local Codex LLM, language model, and image modalities', () => {
    expect(Object.keys(codexAdapter).sort()).toEqual([
      'completeLlm',
      'completeVision',
      'image',
      'languageModel',
      'providerKey',
      'streamLlm',
    ])
    expect(codexAdapter.providerKey).toBe('codex')
    expect(codexAdapter.image?.describe({
      provider: 'codex',
      modelId: 'gpt-image-2',
      modelKey: 'codex::gpt-image-2',
      variantSubKind: 'official',
    }).optionSchema.allowedKeys.has('codexModelId')).toBe(true)
  })

  it('runs Codex text completion through providerConfig.baseUrl', async () => {
    const result = await runCodexLlmCompletion({
      providerConfig: {
        id: 'codex',
        name: 'Codex Local',
        apiKey: '',
        baseUrl: '/opt/codex',
      },
      modelId: 'gpt-5.5',
      messages: [{ role: 'user', content: 'say ok' }],
    })

    expect(result.text).toBe('Codex response')
    expect(result.completion.model).toBe('gpt-5.5')
    expect(result.logProvider).toBe('codex')
    expect(runCodexTextCompletionMock).toHaveBeenCalledWith({
      codexPath: '/opt/codex',
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'say ok' }],
    })
  })

  it('runs Codex vision completion through image inputs and text completion', async () => {
    const result = await runCodexVisionCompletion({
      userId: 'user-1',
      providerKey: 'codex',
      providerConfig: {
        id: 'codex',
        name: 'Codex Local',
        apiKey: '',
        baseUrl: '/opt/codex',
      },
      selection: {
        provider: 'codex',
        modelId: 'gpt-5.5',
        modelKey: 'codex::gpt-5.5',
        variantSubKind: 'official',
      },
      textPrompt: 'Analyze the scene.',
      imageUrls: ['data:image/png;base64,QQ=='],
      temperature: 0.2,
      reasoning: false,
    })

    expect(result.text).toBe('Codex response')
    expect(result.completion.model).toBe('gpt-5.5')
    expect(prepareCodexImageInputsMock).toHaveBeenCalledWith(
      ['data:image/png;base64,QQ=='],
      expect.any(Function),
    )
    expect(runCodexTextCompletionMock).toHaveBeenCalledWith({
      codexPath: '/opt/codex',
      model: 'gpt-5.5',
      imagePaths: ['/tmp/ref-a.png', '/tmp/ref-b.png'],
      messages: [{
        role: 'user',
        content: expect.stringContaining('Analyze the scene.'),
      }],
    })
    expect(cleanupMock).toHaveBeenCalledTimes(1)
  })

  it('streams Codex completion as a single text chunk without pretending provider token streaming exists', async () => {
    const stages: string[] = []
    const chunks: string[] = []

    const result = await runCodexLlmStream({
      userId: 'user-1',
      providerConfig: {
        id: 'codex',
        name: 'Codex Local',
        apiKey: '',
        baseUrl: '/opt/codex',
      },
      selection: {
        provider: 'codex',
        modelId: 'gpt-5.5',
        modelKey: 'codex::gpt-5.5',
      },
      messages: [{ role: 'user', content: 'say ok' }],
      options: {},
      callbacks: {
        onStage: (stage) => stages.push(stage.stage),
        onChunk: (chunk) => chunks.push(chunk.delta),
      },
    })

    expect(result.text).toBe('Codex response')
    expect(stages).toEqual(['streaming', 'completed'])
    expect(chunks).toEqual(['Codex response'])
  })

  it('creates an AI SDK language model backed by Codex CLI text generation', async () => {
    const model = createTestCodexLanguageModel()

    const result = await model.doGenerate({
      prompt: [
        { role: 'system', content: 'Be terse.' },
        { role: 'user', content: [{ type: 'text', text: 'say ok' }] },
      ],
    })

    expect(model.provider).toBe('codex')
    expect(model.modelId).toBe('gpt-5.5')
    expect(result.content).toEqual([{ type: 'text', text: 'Codex response' }])
    expect(runCodexTextCompletionMock).toHaveBeenCalledWith({
      codexPath: '/opt/codex',
      model: 'gpt-5.5',
      messages: [
        { role: 'system', content: 'Be terse.' },
        { role: 'user', content: 'say ok' },
      ],
    })
  })

  it('converts Codex structured output into an AI SDK tool call for doGenerate', async () => {
    runCodexTextCompletionMock.mockResolvedValueOnce({
      text: '{"type":"tool_call","toolName":"get_project_phase","input":{"detail":"full"}}',
      stdout: '',
      stderr: '',
    })
    const model = createTestCodexLanguageModel()

    const result = await model.doGenerate({
      prompt: [
        { role: 'system', content: 'Use the project tools.' },
        { role: 'user', content: [{ type: 'text', text: 'read phase' }] },
      ],
      tools: [projectPhaseTool],
    })

    const toolCall = result.content.find((part) => part.type === 'tool-call')
    expect(toolCall).toBeDefined()
    if (!toolCall || toolCall.type !== 'tool-call') throw new Error('EXPECTED_TOOL_CALL')
    expect(toolCall.toolName).toBe('get_project_phase')
    expect(JSON.parse(toolCall.input)).toEqual({ detail: 'full' })
    expect(toolCall.toolCallId).toMatch(/^codex_tool_/)
    expect(result.finishReason).toEqual({ unified: 'tool-calls', raw: 'tool_calls' })
    expect(result.warnings).toEqual([])

    const rawCall = runCodexTextCompletionMock.mock.calls[0] as unknown as [CodexTextCompletionInput] | undefined
    const call = rawCall?.[0]
    expect(call?.messages[0]?.content).toContain('Codex tool-call protocol')
    expect(call?.messages[0]?.content).toContain('get_project_phase')
  })

  it('streams Codex structured output as AI SDK tool-call parts', async () => {
    runCodexTextCompletionMock.mockResolvedValueOnce({
      text: '{"type":"tool_call","toolName":"get_project_phase","input":{"detail":"summary"}}',
      stdout: '',
      stderr: '',
    })
    const model = createTestCodexLanguageModel()

    const result = await model.doStream({
      prompt: [
        { role: 'system', content: 'Use the project tools.' },
        { role: 'user', content: [{ type: 'text', text: 'read phase' }] },
      ],
      tools: [projectPhaseTool],
    })
    const parts = await readLanguageModelStreamParts(result.stream)

    expect(parts).toContainEqual({ type: 'stream-start', warnings: [] })
    expect(parts).toContainEqual(expect.objectContaining({
      type: 'tool-input-start',
      toolName: 'get_project_phase',
    }))
    expect(parts).toContainEqual(expect.objectContaining({
      type: 'tool-call',
      toolName: 'get_project_phase',
      input: '{"detail":"summary"}',
    }))
    expect(parts).toContainEqual({
      type: 'finish',
      usage: expect.any(Object),
      finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
    })
  })

  it('fails loudly when Codex requests an unavailable tool', async () => {
    runCodexTextCompletionMock.mockResolvedValueOnce({
      text: '{"type":"tool_call","toolName":"missing_tool","input":{}}',
      stdout: '',
      stderr: '',
    })
    const model = createTestCodexLanguageModel()

    await expect(model.doGenerate({
      prompt: [
        { role: 'system', content: 'Use the project tools.' },
        { role: 'user', content: [{ type: 'text', text: 'read phase' }] },
      ],
      tools: [projectPhaseTool],
    })).rejects.toThrow('CODEX_TOOL_CALL_UNKNOWN_TOOL:missing_tool')
  })

  it('executes Codex local image generation with reference image normalization', async () => {
    const result = await codexAdapter.image!.execute({
      userId: 'user-1',
      selection: {
        provider: 'codex',
        modelId: 'gpt-image-2',
        modelKey: 'codex::gpt-image-2',
        variantSubKind: 'official',
      },
      prompt: 'combine these references',
      options: {
        referenceImages: ['https://example.test/a.png', 'https://example.test/b.png'],
        aspectRatio: '16:9',
        outputFormat: 'png',
        codexModelId: 'gpt-5.5',
      },
    })

    expect(result).toMatchObject({
      success: true,
      imageBase64: 'UE5H',
      imageUrl: 'data:image/png;base64,UE5H',
    })
    expect(getProviderConfigMock).toHaveBeenCalledWith('user-1', 'codex')
    expect(prepareCodexImageInputsMock).toHaveBeenCalledWith(
      ['https://example.test/a.png', 'https://example.test/b.png'],
      normalizeToBase64ForGenerationMock,
    )
    expect(cleanupMock).toHaveBeenCalledTimes(1)
    const rawCall = runCodexImageGenerationMock.mock.calls[0] as unknown[] | undefined
    const call = rawCall?.[0] as { codexPath?: string; model?: string; imagePaths?: string[]; prompt: string } | undefined
    expect(call).toBeDefined()
    expect(call!).toMatchObject({
      codexPath: '/usr/local/bin/codex',
      model: 'gpt-5.5',
      imagePaths: ['/tmp/ref-a.png', '/tmp/ref-b.png'],
    })
    expect(call!.prompt).toContain('Target image model: gpt-image-2')
    expect(call!.prompt).toContain('Mode: multi-reference image fusion')
    expect(call!.prompt).toContain('Do not make a collage')
  })
})
