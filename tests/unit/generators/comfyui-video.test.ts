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
  it('auto-routes the default ltx23 workflow from prompt and duration context', () => {
    expect(selectComfyUiVideoWorkflowKey(
      COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID,
      '男子突然转身奔跑，镜头跟拍并逐渐推近',
      { generationMode: 'normal', duration: 6 },
    )).toBe(COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion)

    expect(selectComfyUiVideoWorkflowKey(
      COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID,
      'GLOBAL: hospital room. LOCAL: Scene 1：女子抬头 | Scene 2：镜头缓慢推近',
      { generationMode: 'normal', duration: 16 },
    )).toBe(COMFYUI_LTX23_WORKFLOW_KEYS.damaichaLongPromptRelay)
  })

  it('preserves the default ltx23 workflow when manual selection is explicit', () => {
    expect(selectComfyUiVideoWorkflowKey(
      COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID,
      '男子突然转身奔跑，镜头跟拍并逐渐推近',
      { generationMode: 'normal', duration: 6, ltx23WorkflowSelection: 'manual' },
    )).toBe(COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID)
  })

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

  it('auto-routes the default ltx23 workflow and forwards non-empty reference images', async () => {
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
      workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion,
      durationSeconds: 12,
      referenceImageUrls: [
        'https://example.com/ref-a.png',
        'https://example.com/ref-b.png',
      ],
    }))
  })

  it('rejects removed legacy LTX2.3 workflow keys instead of routing them', async () => {
    const generator = new ComfyUIVideoGenerator()
    getProviderConfigMock.mockResolvedValueOnce({
      id: 'comfyui',
      name: 'ComfyUI',
      apiKey: '',
      baseUrl: '',
    })

    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/first.png',
      prompt: 'legacy qshan prompt',
      options: {
        modelId: 'basevideo/demo/LTX2.3-fast',
      },
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('LEGACY_LTX23_WORKFLOW_REMOVED')
    expect(getProviderConfigMock).not.toHaveBeenCalled()
    expect(runComfyUiVideoWorkflowMock).not.toHaveBeenCalled()
  })
})
