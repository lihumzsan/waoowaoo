import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ComfyUIVideoGenerator, selectComfyUiVideoWorkflowKey } from '@/lib/generators/comfyui-video'
import {
  COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID,
  COMFYUI_LTX23_WORKFLOW_KEYS,
} from '@/lib/providers/comfyui/ltx23-workflow-profiles'
import { getProviderConfig } from '@/lib/api-config'
import { isComfyUiWorkflowLlmApiRequired, runComfyUiVideoWorkflow } from '@/lib/providers/comfyui/client'

vi.mock('@/lib/api-config', () => ({
  getProviderConfig: vi.fn(),
}))

vi.mock('@/lib/providers/comfyui/client', () => ({
  isComfyUiWorkflowLlmApiRequired: vi.fn(),
  runComfyUiVideoWorkflow: vi.fn(),
}))

vi.mock('@/lib/providers/comfyui/llm-api-config', () => ({
  resolveComfyUiLlmApiConfig: vi.fn(),
}))

const getProviderConfigMock = vi.mocked(getProviderConfig)
const isComfyUiWorkflowLlmApiRequiredMock = vi.mocked(isComfyUiWorkflowLlmApiRequired)
const runComfyUiVideoWorkflowMock = vi.mocked(runComfyUiVideoWorkflow)

describe('ComfyUI video workflow selection', () => {
  it('keeps the latest first-last-frame profile workflow request unchanged', () => {
    expect(selectComfyUiVideoWorkflowKey(COMFYUI_LTX23_WORKFLOW_KEYS.smoothFirstLastFrame, 'bridge the two frames', {
      generationMode: 'firstlastframe',
    })).toBe(COMFYUI_LTX23_WORKFLOW_KEYS.smoothFirstLastFrame)
  })

  it('keeps latest ltx23 profile workflow ids unchanged', () => {
    expect(selectComfyUiVideoWorkflowKey(
      COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion,
      'GLOBAL: rain alley\nLOCAL: [0-16] character runs forward',
      { generationMode: 'normal' },
    )).toBe(COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion)
  })
})

describe('ComfyUI video generator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getProviderConfigMock.mockResolvedValue({
      id: 'comfyui',
      name: 'ComfyUI',
      apiKey: '',
      baseUrl: 'https://comfy.example',
    })
    isComfyUiWorkflowLlmApiRequiredMock.mockReturnValue(false)
    runComfyUiVideoWorkflowMock.mockResolvedValue({
      videoBase64: 'video-base64',
      mimeType: 'video/mp4',
    })
  })

  it('uses the ltx23 default workflow and forwards non-empty reference images', async () => {
    const generator = new ComfyUIVideoGenerator()

    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/first.png',
      prompt: 'GLOBAL: rain alley\nLOCAL: [0-16] character runs forward',
      options: {
        referenceImageUrls: [
          'https://example.com/ref-a.png',
          123,
          ' ',
          'https://example.com/ref-b.png',
          '',
          null,
        ] as unknown as string[],
      },
    })

    expect(result.success).toBe(true)
    expect(runComfyUiVideoWorkflowMock).toHaveBeenCalledWith(expect.objectContaining({
      workflowKey: COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID,
      referenceImageUrls: [
        'https://example.com/ref-a.png',
        'https://example.com/ref-b.png',
      ],
    }))
  })
})
