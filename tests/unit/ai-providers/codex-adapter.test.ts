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
import { createCodexLanguageModel, runCodexLlmCompletion, runCodexLlmStream } from '@/lib/ai-providers/codex/llm'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'

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
    const model = createCodexLanguageModel({
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
