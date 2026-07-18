import { beforeEach, describe, expect, it, vi } from 'vitest'

const cleanupMock = vi.hoisted(() => vi.fn(async () => undefined))
const getProviderConfigMock = vi.hoisted(() => vi.fn(async () => ({
  id: 'codex',
  name: 'Codex (Local)',
  apiKey: '',
  baseUrl: 'C:\\codex.exe',
})))
const prepareCodexImageInputsMock = vi.hoisted(() => vi.fn(async (
  inputs: string[],
  normalizer: (input: string) => Promise<string>,
) => {
  void inputs
  void normalizer
  return {
    imagePaths: ['C:\\tmp\\ref-a.png', 'C:\\tmp\\ref-b.png'],
    cleanup: cleanupMock,
  }
}))
const runCodexImageGenerationMock = vi.hoisted(() => vi.fn(async (params: {
  codexPath?: string
  model?: string
  prompt: string
  imagePaths?: string[]
}) => {
  void params
  return {
    imageBase64: 'UE5H',
    mimeType: 'image/png',
    imagePath: 'C:\\tmp\\out.png',
    text: '{"image_path":"C:\\\\tmp\\\\out.png"}',
    stdout: '',
    stderr: '',
  }
}))
const normalizeToBase64ForGenerationMock = vi.hoisted(() => vi.fn(async () => 'data:image/png;base64,QQ=='))

vi.mock('@/lib/api-config', () => ({
  getProviderConfig: getProviderConfigMock,
}))

vi.mock('@/lib/providers/codex/client', () => ({
  prepareCodexImageInputs: prepareCodexImageInputsMock,
  runCodexImageGeneration: runCodexImageGenerationMock,
}))

vi.mock('@/lib/media/outbound-image', () => ({
  normalizeToBase64ForGeneration: normalizeToBase64ForGenerationMock,
}))

import { CodexImageGenerator } from '@/lib/generators/image/codex'

describe('CodexImageGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanupMock.mockResolvedValue(undefined)
    getProviderConfigMock.mockResolvedValue({
      id: 'codex',
      name: 'Codex (Local)',
      apiKey: '',
      baseUrl: 'C:\\codex.exe',
    })
    prepareCodexImageInputsMock.mockResolvedValue({
      imagePaths: ['C:\\tmp\\ref-a.png', 'C:\\tmp\\ref-b.png'],
      cleanup: cleanupMock,
    })
    runCodexImageGenerationMock.mockResolvedValue({
      imageBase64: 'UE5H',
      mimeType: 'image/png',
      imagePath: 'C:\\tmp\\out.png',
      text: '{"image_path":"C:\\\\tmp\\\\out.png"}',
      stdout: '',
      stderr: '',
    })
  })

  it('uses codex image generation for text-to-image prompts', async () => {
    const generator = new CodexImageGenerator('gpt-image-2')

    const result = await generator.generate({
      userId: 'user-1',
      prompt: 'draw a glass house in the desert',
      options: {
        aspectRatio: '16:9',
        outputFormat: 'png',
      },
    })

    expect(result).toMatchObject({
      success: true,
      imageBase64: 'UE5H',
      imageUrl: 'data:image/png;base64,UE5H',
    })
    expect(prepareCodexImageInputsMock).not.toHaveBeenCalled()
    expect(runCodexImageGenerationMock).toHaveBeenCalledTimes(1)
    const call = runCodexImageGenerationMock.mock.calls[0]![0]
    expect(call).toMatchObject({
      codexPath: 'C:\\codex.exe',
      model: 'gpt-5.5',
      imagePaths: [],
    })
    expect(call.prompt).toContain('Mode: text-to-image')
    expect(call.prompt).toContain('draw a glass house in the desert')
    expect(call.prompt).toContain('Target image model: gpt-image-2')
    expect(call.prompt).toContain('Use the image_generation capability to create one raster image now')
    expect(call.prompt).toContain('Do not answer with text only')
    expect(call.prompt).toContain('copy or save that final image into the current working directory')
    expect(call.prompt).toContain('Return only JSON')
  })

  it('passes multiple reference images and asks codex to fuse them into one scene', async () => {
    const generator = new CodexImageGenerator('gpt-image-2')

    const result = await generator.generate({
      userId: 'user-1',
      prompt: 'combine the product, model, and beach scene into a single ad image',
      referenceImages: ['https://example.test/product.png', 'https://example.test/model.png'],
      options: {
        aspectRatio: '3:4',
      },
    })

    expect(result.success).toBe(true)
    expect(prepareCodexImageInputsMock).toHaveBeenCalledWith(
      ['https://example.test/product.png', 'https://example.test/model.png'],
      normalizeToBase64ForGenerationMock,
    )
    expect(cleanupMock).toHaveBeenCalledTimes(1)
    const call = runCodexImageGenerationMock.mock.calls[0]![0]
    expect(call).toMatchObject({
      imagePaths: ['C:\\tmp\\ref-a.png', 'C:\\tmp\\ref-b.png'],
    })
    expect(call.prompt).toContain('Mode: multi-reference image fusion')
    expect(call.prompt).toContain('Reference Image 1')
    expect(call.prompt).toContain('Reference Image 2')
    expect(call.prompt).toContain('fuse all references into one coherent new image')
    expect(call.prompt).toContain('Do not make a collage')
    expect(call.prompt).toContain('combine the product, model, and beach scene')
  })

  it('returns codex stdout and stderr snippets when generation fails', async () => {
    runCodexImageGenerationMock.mockRejectedValue(Object.assign(
      new Error('CODEX_IMAGE_OUTPUT_NOT_FOUND: Codex image generation completed without a readable image path'),
      {
        stdout: '{"type":"thread.started"}\n{"type":"turn.started"}',
        stderr: 'stream disconnected - retrying sampling request',
      },
    ))
    const generator = new CodexImageGenerator('gpt-image-2')

    const result = await generator.generate({
      userId: 'user-1',
      prompt: 'draw a red square',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('CODEX_IMAGE_OUTPUT_NOT_FOUND')
    expect(result.error).toContain('stdout:')
    expect(result.error).toContain('thread.started')
    expect(result.error).toContain('stderr:')
    expect(result.error).toContain('stream disconnected')
  })
})
