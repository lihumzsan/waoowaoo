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

const MULTI_SHOT_WORKFLOW = 'basevideo/多镜头/Ltx2.3多镜头时间+逻辑控制PromptRelay和VBVR（KJ版）1'
const SINGLE_SHOT_WORKFLOW = 'basevideo/图生视频/ltx2.3-图生视频-没字幕版'

describe('ComfyUI video workflow selection', () => {
  it('routes normal single-panel generation away from multi-shot workflows', () => {
    expect(selectComfyUiVideoWorkflowKey(MULTI_SHOT_WORKFLOW, 'GLOBAL: office\nLOCAL: [0-4] doctor speaks', {
      generationMode: 'normal',
    })).toBe(SINGLE_SHOT_WORKFLOW)
  })

  it('keeps multi-shot workflows only for explicit range generation', () => {
    expect(selectComfyUiVideoWorkflowKey(MULTI_SHOT_WORKFLOW, 'GLOBAL: office\nLOCAL: [0-4] doctor speaks', {
      generationMode: 'normal',
      multiShotRange: true,
    })).toBe(MULTI_SHOT_WORKFLOW)
  })

  it('does not rewrite first-last-frame workflow requests', () => {
    const firstLastWorkflow = 'basevideo/首尾帧/ltx2.3首尾帧'
    expect(selectComfyUiVideoWorkflowKey(firstLastWorkflow, 'bridge the two frames', {
      generationMode: 'firstlastframe',
    })).toBe(firstLastWorkflow)
  })

  it('does not rewrite new ltx23 profile keys through legacy multi-shot fallback', () => {
    expect(selectComfyUiVideoWorkflowKey(
      COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion,
      'GLOBAL: rain alley\nLOCAL: [0-16] character runs forward',
      { generationMode: 'normal' },
    )).toBe(COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion)
  })

  it('passes through new ltx23 profile workflow ids', () => {
    const profileWorkflow = 'basevideo/ltx23-profiles/custom-profile-under-test'

    expect(selectComfyUiVideoWorkflowKey(
      profileWorkflow,
      'GLOBAL: rain alley\nLOCAL: [0-16] character runs forward',
      { generationMode: 'normal', multiShotRange: true },
    )).toBe(profileWorkflow)
  })
})

describe('ComfyUI video generator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getProviderConfigMock.mockResolvedValue({ baseUrl: 'https://comfy.example' })
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
