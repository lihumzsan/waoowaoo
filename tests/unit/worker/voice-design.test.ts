import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const constantsMock = vi.hoisted(() => ({
  COMFYUI_VOICE_DESIGN_WORKFLOW_ID: 'baseaudio/\u97f3\u8272/s2-se',
  COMFYUI_MULTI_SPEAKER_AUDIO_MODEL_ID: 'baseaudio/\u591a\u4eba/LongCat-two',
}))

const bailianMock = vi.hoisted(() => ({
  validateVoicePrompt: vi.fn(),
  validatePreviewText: vi.fn(),
}))

const apiConfigMock = vi.hoisted(() => ({
  getModelsByType: vi.fn(),
  getProviderConfig: vi.fn(),
  getProviderKey: vi.fn((providerId: string) => providerId.split(':')[0] || providerId),
  resolveModelSelection: vi.fn(),
}))

const configServiceMock = vi.hoisted(() => ({
  composeModelKey: vi.fn((provider: string, modelId: string) => `${provider}::${modelId}`),
  extractModelKey: vi.fn((value: string | null | undefined) => value || null),
  getProjectModelConfig: vi.fn(),
  getUserModelConfig: vi.fn(),
}))

const comfyClientMock = vi.hoisted(() => ({
  runComfyUiAudioWorkflow: vi.fn(),
}))

const fishAudioMock = vi.hoisted(() => ({
  buildComfyUiDesignedVoiceId: vi.fn(() => 'comfyui:voice-preview'),
  COMFYUI_FISH_AUDIO_S2_VOICE_DESIGN_WORKFLOW_ID: constantsMock.COMFYUI_VOICE_DESIGN_WORKFLOW_ID,
  generateFishAudioS2Prompt: vi.fn(),
}))

const prismaMock = vi.hoisted(() => ({
  prisma: {
    userPreference: {
      findUnique: vi.fn(),
    },
    globalCharacter: {
      findFirst: vi.fn(),
    },
    novelPromotionCharacter: {
      findFirst: vi.fn(),
    },
  },
}))

const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))

vi.mock('@/lib/providers/bailian/voice-design', () => bailianMock)
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/providers/comfyui/client', () => comfyClientMock)
vi.mock('@/lib/voice-design/fish-audio-s2', () => fishAudioMock)
vi.mock('@/lib/prisma', () => prismaMock)
vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: workerMock.reportTaskProgress,
}))
vi.mock('@/lib/workers/utils', () => ({
  assertTaskActive: workerMock.assertTaskActive,
}))

import { handleVoiceDesignTask } from '@/lib/workers/handlers/voice-design'

const {
  COMFYUI_VOICE_DESIGN_WORKFLOW_ID,
  COMFYUI_MULTI_SPEAKER_AUDIO_MODEL_ID,
} = constantsMock

function buildJob(type: TaskJobData['type'], payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-voice-1',
      type,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: null,
      targetType: 'VoiceDesign',
      targetId: 'voice-design-1',
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker voice-design behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bailianMock.validateVoicePrompt.mockReturnValue({ valid: true })
    bailianMock.validatePreviewText.mockReturnValue({ valid: true })
    apiConfigMock.getProviderConfig.mockResolvedValue({ id: 'comfyui', apiKey: 'bailian-key', baseUrl: 'http://127.0.0.1:8188' })
    configServiceMock.getProjectModelConfig.mockResolvedValue({ analysisModel: 'bailian::qwen3.5-plus' })
    configServiceMock.getUserModelConfig.mockResolvedValue({ analysisModel: 'bailian::qwen3.5-plus', voiceDesignModel: null })
    prismaMock.prisma.userPreference.findUnique.mockResolvedValue({
      voiceDesignModel: `comfyui::${COMFYUI_VOICE_DESIGN_WORKFLOW_ID}`,
      audioModel: null,
    })
    prismaMock.prisma.globalCharacter.findFirst.mockResolvedValue(null)
    prismaMock.prisma.novelPromotionCharacter.findFirst.mockResolvedValue(null)
    apiConfigMock.resolveModelSelection.mockResolvedValue({
      provider: 'comfyui',
      modelId: COMFYUI_VOICE_DESIGN_WORKFLOW_ID,
      modelKey: `comfyui::${COMFYUI_VOICE_DESIGN_WORKFLOW_ID}`,
      mediaType: 'audio',
    })
    fishAudioMock.generateFishAudioS2Prompt.mockResolvedValue({
      voicePrompt: 'calm, steady, trusted',
      fishText: '[calm]hello there',
    })
    comfyClientMock.runComfyUiAudioWorkflow.mockResolvedValue({
      audioBase64: 'comfy-audio',
      mimeType: 'audio/wav',
    })
  })

  it('missing required fields -> explicit error', async () => {
    const job = buildJob(TASK_TYPE.VOICE_DESIGN, { previewText: 'hello' })
    await expect(handleVoiceDesignTask(job)).rejects.toThrow('voicePrompt is required')
  })

  it('invalid prompt validation -> explicit error message from validator', async () => {
    bailianMock.validateVoicePrompt.mockReturnValue({ valid: false, error: 'bad prompt' })

    const job = buildJob(TASK_TYPE.VOICE_DESIGN, {
      voicePrompt: 'x',
      previewText: 'hello',
    })
    await expect(handleVoiceDesignTask(job)).rejects.toThrow('bad prompt')
  })

  it('falls back to audioModel when voiceDesignModel is missing but s2-se is configured there', async () => {
    prismaMock.prisma.userPreference.findUnique.mockResolvedValue({
      voiceDesignModel: null,
      audioModel: `comfyui::${COMFYUI_VOICE_DESIGN_WORKFLOW_ID}`,
    })

    const job = buildJob(TASK_TYPE.ASSET_HUB_VOICE_DESIGN, {
      voicePrompt: 'steady male voice',
      previewText: 'hello there',
      preferredName: 'doctor_voice',
    })

    await handleVoiceDesignTask(job)

    expect(apiConfigMock.resolveModelSelection).toHaveBeenCalledWith(
      'user-1',
      `comfyui::${COMFYUI_VOICE_DESIGN_WORKFLOW_ID}`,
      'audio',
    )
    expect(comfyClientMock.runComfyUiAudioWorkflow).toHaveBeenCalled()
  })

  it('falls back to the built-in comfyui s2-se workflow when the provider is configured but the model row is missing', async () => {
    prismaMock.prisma.userPreference.findUnique.mockResolvedValue({
      voiceDesignModel: null,
      audioModel: `comfyui::${COMFYUI_MULTI_SPEAKER_AUDIO_MODEL_ID}`,
    })
    apiConfigMock.getModelsByType.mockResolvedValueOnce([
      {
        provider: 'comfyui',
        modelId: COMFYUI_MULTI_SPEAKER_AUDIO_MODEL_ID,
        modelKey: `comfyui::${COMFYUI_MULTI_SPEAKER_AUDIO_MODEL_ID}`,
        type: 'audio',
      },
    ])
    apiConfigMock.resolveModelSelection.mockImplementation(async (_userId: string, modelKey: string) => {
      if (modelKey === `comfyui::${COMFYUI_MULTI_SPEAKER_AUDIO_MODEL_ID}`) {
        return {
          provider: 'comfyui',
          modelId: COMFYUI_MULTI_SPEAKER_AUDIO_MODEL_ID,
          modelKey,
          mediaType: 'audio',
        }
      }
      throw new Error('MODEL_NOT_FOUND')
    })

    const job = buildJob(TASK_TYPE.ASSET_HUB_VOICE_DESIGN, {
      voicePrompt: 'steady male voice',
      previewText: 'hello there',
      preferredName: 'doctor_voice',
    })

    const result = await handleVoiceDesignTask(job)

    expect(comfyClientMock.runComfyUiAudioWorkflow).toHaveBeenCalledWith({
      baseUrl: 'http://127.0.0.1:8188',
      workflowKey: COMFYUI_VOICE_DESIGN_WORKFLOW_ID,
      prompt: '[calm]hello there',
    })
    expect(result).toEqual(expect.objectContaining({
      success: true,
      targetModel: COMFYUI_VOICE_DESIGN_WORKFLOW_ID,
    }))
  })

  it('ignores an invalid configured voiceDesignModel and falls back to the built-in comfyui s2-se workflow', async () => {
    prismaMock.prisma.userPreference.findUnique.mockResolvedValue({
      voiceDesignModel: 'comfyui::baseaudio/??/s2-se',
      audioModel: `comfyui::${COMFYUI_MULTI_SPEAKER_AUDIO_MODEL_ID}`,
    })
    apiConfigMock.getModelsByType.mockResolvedValueOnce([
      {
        provider: 'comfyui',
        modelId: COMFYUI_MULTI_SPEAKER_AUDIO_MODEL_ID,
        modelKey: `comfyui::${COMFYUI_MULTI_SPEAKER_AUDIO_MODEL_ID}`,
        type: 'audio',
      },
    ])
    apiConfigMock.resolveModelSelection.mockImplementation(async (_userId: string, modelKey: string) => {
      if (modelKey === 'comfyui::baseaudio/??/s2-se') {
        throw new Error('MODEL_NOT_FOUND')
      }
      if (modelKey === `comfyui::${COMFYUI_MULTI_SPEAKER_AUDIO_MODEL_ID}`) {
        return {
          provider: 'comfyui',
          modelId: COMFYUI_MULTI_SPEAKER_AUDIO_MODEL_ID,
          modelKey,
          mediaType: 'audio',
        }
      }
      throw new Error('MODEL_NOT_FOUND')
    })

    const job = buildJob(TASK_TYPE.ASSET_HUB_VOICE_DESIGN, {
      voicePrompt: 'steady male voice',
      previewText: 'hello there',
      preferredName: 'doctor_voice',
    })

    const result = await handleVoiceDesignTask(job)

    expect(comfyClientMock.runComfyUiAudioWorkflow).toHaveBeenCalledWith({
      baseUrl: 'http://127.0.0.1:8188',
      workflowKey: COMFYUI_VOICE_DESIGN_WORKFLOW_ID,
      prompt: '[calm]hello there',
    })
    expect(result).toEqual(expect.objectContaining({
      success: true,
      targetModel: COMFYUI_VOICE_DESIGN_WORKFLOW_ID,
    }))
  })

  it('uses bailian to build a Fish Audio S2 prompt and then runs the comfyui workflow', async () => {
    prismaMock.prisma.globalCharacter.findFirst.mockResolvedValue({
      name: '\u4e2d\u5e74\u533b\u751f',
      aliases: '\u9648\u8ff9',
      profileData: JSON.stringify({
        role_level: 'B',
        archetype: '\u4e13\u4e1a\u533b\u751f',
        personality_tags: ['\u4e25\u8c28', '\u51b7\u9759'],
        era_period: '\u73b0\u4ee3\u90fd\u5e02',
        social_class: '\u4e2d\u4ea7',
        occupation: '\u533b\u751f',
        costume_tier: 3,
        suggested_colors: ['\u767d'],
        visual_keywords: ['\u9f3b\u6881\u773c\u955c'],
        gender: '\u7537',
        age_range: '\u4e2d\u5e74',
      }),
      appearances: [
        {
          changeReason: '\u9ed8\u8ba4',
          description: '\u767d\u5927\u891b\uff0c\u6234\u773c\u955c\uff0c\u8bf4\u8bdd\u514b\u5236\u3002',
        },
      ],
    })

    const job = buildJob(TASK_TYPE.ASSET_HUB_VOICE_DESIGN, {
      voicePrompt: '\u4e25\u8c28 \u51b7\u9759 \u53ef\u4fe1\u8d56',
      previewText: '\u8bf7\u8ddf\u6211\u6765\uff0c\u5148\u53bb\u505a\u4e00\u4e2a\u68c0\u67e5\u3002',
      preferredName: 'doctor_voice',
      characterId: 'char-1',
    })

    const result = await handleVoiceDesignTask(job)

    expect(fishAudioMock.generateFishAudioS2Prompt).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      model: 'bailian::qwen3.5-plus',
      speakerName: '\u4e2d\u5e74\u533b\u751f',
      userVoicePrompt: '\u4e25\u8c28 \u51b7\u9759 \u53ef\u4fe1\u8d56',
      previewText: '\u8bf7\u8ddf\u6211\u6765\uff0c\u5148\u53bb\u505a\u4e00\u4e2a\u68c0\u67e5\u3002',
      character: expect.objectContaining({
        name: '\u4e2d\u5e74\u533b\u751f',
      }),
    }))
    expect(apiConfigMock.getProviderConfig).toHaveBeenCalledWith('user-1', 'comfyui')
    expect(comfyClientMock.runComfyUiAudioWorkflow).toHaveBeenCalledWith({
      baseUrl: 'http://127.0.0.1:8188',
      workflowKey: COMFYUI_VOICE_DESIGN_WORKFLOW_ID,
      prompt: '[calm]hello there',
    })
    expect(result).toEqual(expect.objectContaining({
      success: true,
      voiceId: 'comfyui:voice-preview',
      audioBase64: 'comfy-audio',
      targetModel: COMFYUI_VOICE_DESIGN_WORKFLOW_ID,
    }))
  })
})
