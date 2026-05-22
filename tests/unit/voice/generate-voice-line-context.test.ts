import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiConfigMock = vi.hoisted(() => ({
  getModelsByType: vi.fn(),
  getProviderKey: vi.fn((providerId: string) => providerId.split(':')[0] || providerId),
}))

const configServiceMock = vi.hoisted(() => ({
  composeModelKey: vi.fn((provider: string, modelId: string) => `${provider}::${modelId}`),
  getProjectModelConfig: vi.fn(),
  getUserModelConfig: vi.fn(),
}))

const fishAudioMock = vi.hoisted(() => ({
  buildFishAudioS2RenderText: vi.fn((input: { fishText: string }) => `render:${input.fishText}`),
  generateFishAudioS2LinePrompt: vi.fn(),
}))

vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/voice-design/fish-audio-s2', () => fishAudioMock)

import { buildComfyUiLineRenderText } from '@/lib/voice/generate-voice-line-context'

describe('buildComfyUiLineRenderText', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configServiceMock.getProjectModelConfig.mockResolvedValue({ analysisModel: null })
    configServiceMock.getUserModelConfig.mockResolvedValue({ analysisModel: null })
    apiConfigMock.getModelsByType.mockResolvedValue([])
    fishAudioMock.generateFishAudioS2LinePrompt.mockResolvedValue({
      fishText: '[calm]可以。',
      voicePrompt: 'calm restrained',
    })
  })

  it('prefers the configured non-bailian project analysis model for line prompt enhancement', async () => {
    configServiceMock.getProjectModelConfig.mockResolvedValue({
      analysisModel: 'openrouter::x-ai/grok-4.1-fast',
    })

    const result = await buildComfyUiLineRenderText({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'project-1',
      workflowKey: 'baseaudio/单人/s2-one',
      speakerName: '陈迹',
      lineIndex: 1,
      lineText: '可以。',
      emotionPrompt: '克制',
    })

    expect(fishAudioMock.generateFishAudioS2LinePrompt).toHaveBeenCalledWith(expect.objectContaining({
      model: 'openrouter::x-ai/grok-4.1-fast',
    }))
    expect(apiConfigMock.getModelsByType).not.toHaveBeenCalledWith('user-1', 'llm')
    expect(result).toEqual({
      renderText: 'render:[calm]可以。',
      derivedEmotionPrompt: 'calm restrained',
    })
  })

  it('does not apply Fish Audio S2 bracket tags to LongCat workflows', async () => {
    configServiceMock.getProjectModelConfig.mockResolvedValue({
      analysisModel: 'openrouter::x-ai/grok-4.1-fast',
    })

    const result = await buildComfyUiLineRenderText({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'project-1',
      workflowKey: 'baseaudio/单人/LongCat-one',
      speakerName: '陈迹',
      lineIndex: 1,
      lineText: '可以。',
      emotionPrompt: '冷静',
    })

    expect(fishAudioMock.generateFishAudioS2LinePrompt).not.toHaveBeenCalled()
    expect(fishAudioMock.buildFishAudioS2RenderText).not.toHaveBeenCalled()
    expect(result).toEqual({
      renderText: '可以。',
      derivedEmotionPrompt: '冷静',
    })
  })
})
