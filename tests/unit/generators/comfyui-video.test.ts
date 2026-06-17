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
const BERNINI_WORKFLOW_ID = 'basevideo/seedance2/bernini-480p-i2v'
const BERNINI_AUDIO_WORKFLOW_ID = 'basevideo/seedance2/bernini-480p-i2v-audio-lipsync'

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

  it('keeps Seedance2 Bernini workflow requests out of the LTX2.3 auto-router', () => {
    expect(selectComfyUiVideoWorkflowKey(
      BERNINI_WORKFLOW_ID,
      'GLOBAL: rain alley\nLOCAL: character runs forward for a long shot',
      { generationMode: 'normal', duration: 16 },
    )).toBe(BERNINI_WORKFLOW_ID)
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

  it('normalizes removed LTX2.3 profile requests to Bernini and forwards non-empty reference images', async () => {
    const generator = new ComfyUIVideoGenerator()

    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/first.png',
      prompt: 'GLOBAL: rain alley\nLOCAL: [0-16] character runs forward',
      options: {
        modelId: COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID,
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
      workflowKey: BERNINI_WORKFLOW_ID,
      referenceImageUrls: [
        'https://example.com/ref-a.png',
        'https://example.com/ref-b.png',
      ],
    }))
  })

  it('routes Bernini video generation with reference audio to the audio lipsync workflow', async () => {
    const generator = new ComfyUIVideoGenerator()

    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/first.png',
      prompt: 'doctor speaks to the selected line',
      options: {
        modelId: COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID,
        referenceAudioUrls: [
          'https://example.com/line-1.wav',
          123,
          ' ',
          'https://example.com/line-2.mp3',
          null,
        ] as unknown as string[],
      },
    })

    expect(result.success).toBe(true)
    expect(runComfyUiVideoWorkflowMock).toHaveBeenCalledWith(expect.objectContaining({
      workflowKey: BERNINI_AUDIO_WORKFLOW_ID,
      referenceAudioUrls: [
        'https://example.com/line-1.wav',
        'https://example.com/line-2.mp3',
      ],
    }))
  })

  it('rejects removed legacy LTX2.3 workflow keys instead of routing them', async () => {
    const generator = new ComfyUIVideoGenerator()

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

  it('forwards Bernini motion strength and timing controls to the ComfyUI workflow client', async () => {
    const generator = new ComfyUIVideoGenerator()

    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/first.png',
      prompt: 'woman sits quietly by the window',
      options: {
        modelId: BERNINI_WORKFLOW_ID,
        duration: 5,
        fps: 24,
        motionStrength: 1,
        size: '480x848',
      },
    })

    expect(result.success).toBe(true)
    expect(runComfyUiVideoWorkflowMock).toHaveBeenCalledWith(expect.objectContaining({
      workflowKey: BERNINI_WORKFLOW_ID,
      durationSeconds: 5,
      fps: 24,
      motionStrength: 1,
      width: 480,
      height: 848,
    }))
  })
})
