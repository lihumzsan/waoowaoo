import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const bailianMock = vi.hoisted(() => ({
  createVoiceDesign: vi.fn(),
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
  COMFYUI_FISH_AUDIO_S2_VOICE_DESIGN_WORKFLOW_ID: 'baseaudio/音色/s2-se',
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
    apiConfigMock.getProviderConfig.mockResolvedValue({ apiKey: 'bailian-key', baseUrl: 'http://127.0.0.1:8188' })
    configServiceMock.getProjectModelConfig.mockResolvedValue({ analysisModel: 'bailian::qwen3.5-plus' })
    configServiceMock.getUserModelConfig.mockResolvedValue({ analysisModel: 'bailian::qwen3.5-plus' })
    prismaMock.prisma.userPreference.findUnique.mockResolvedValue({ voiceDesignModel: 'bailian::qwen-voice-design' })
    prismaMock.prisma.globalCharacter.findFirst.mockResolvedValue(null)
    prismaMock.prisma.novelPromotionCharacter.findFirst.mockResolvedValue(null)
    bailianMock.createVoiceDesign.mockResolvedValue({
      success: true,
      voiceId: 'voice-id-1',
      targetModel: 'bailian-tts',
      audioBase64: 'base64-audio',
      sampleRate: 24000,
      responseFormat: 'mp3',
      usageCount: 11,
      requestId: 'req-1',
    })
    apiConfigMock.resolveModelSelection.mockResolvedValue({
      provider: 'bailian',
      modelId: 'qwen-voice-design',
      modelKey: 'bailian::qwen-voice-design',
      mediaType: 'audio',
    })
    fishAudioMock.generateFishAudioS2Prompt.mockResolvedValue({
      voicePrompt: '冷静理性',
      fishText: '[冷静]你好。',
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

  it('uses bailian voice design when the configured voiceDesignModel is bailian', async () => {
    const job = buildJob(TASK_TYPE.ASSET_HUB_VOICE_DESIGN, {
      voicePrompt: '  calm female narrator  ',
      previewText: '  hello world  ',
      preferredName: '  custom_name  ',
      language: 'en',
    })

    const result = await handleVoiceDesignTask(job)

    expect(apiConfigMock.resolveModelSelection).toHaveBeenCalledWith('user-1', 'bailian::qwen-voice-design', 'audio')
    expect(apiConfigMock.getProviderConfig).toHaveBeenCalledWith('user-1', 'bailian')
    expect(bailianMock.createVoiceDesign).toHaveBeenCalledWith({
      voicePrompt: 'calm female narrator',
      previewText: 'hello world',
      preferredName: 'custom_name',
      language: 'en',
    }, 'bailian-key')

    expect(result).toEqual(expect.objectContaining({
      success: true,
      voiceId: 'voice-id-1',
      taskType: TASK_TYPE.ASSET_HUB_VOICE_DESIGN,
    }))
  })

  it('uses bailian to build a Fish Audio S2 prompt and then runs the comfyui workflow', async () => {
    prismaMock.prisma.userPreference.findUnique.mockResolvedValue({ voiceDesignModel: 'comfyui::baseaudio/音色/s2-se' })
    apiConfigMock.resolveModelSelection.mockResolvedValue({
      provider: 'comfyui',
      modelId: 'baseaudio/音色/s2-se',
      modelKey: 'comfyui::baseaudio/音色/s2-se',
      mediaType: 'audio',
    })
    prismaMock.prisma.globalCharacter.findFirst.mockResolvedValue({
      name: '中年医生',
      aliases: '陈医生',
      profileData: JSON.stringify({
        role_level: 'B',
        archetype: '专业医生',
        personality_tags: ['严谨', '冷静'],
        era_period: '现代都市',
        social_class: '中产',
        occupation: '医生',
        costume_tier: 3,
        suggested_colors: ['白'],
        visual_keywords: ['鼻梁眼镜'],
        gender: '男',
        age_range: '中年',
      }),
      appearances: [
        {
          changeReason: '默认',
          description: '白大褂，戴眼镜，说话克制。',
        },
      ],
    })

    const job = buildJob(TASK_TYPE.ASSET_HUB_VOICE_DESIGN, {
      voicePrompt: '严谨 冷静 可信赖',
      previewText: '请跟我来，先去做个检查。',
      preferredName: 'doctor_voice',
      characterId: 'char-1',
    })

    const result = await handleVoiceDesignTask(job)

    expect(fishAudioMock.generateFishAudioS2Prompt).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      model: 'bailian::qwen3.5-plus',
      speakerName: '中年医生',
      userVoicePrompt: '严谨 冷静 可信赖',
      previewText: '请跟我来，先去做个检查。',
      character: expect.objectContaining({
        name: '中年医生',
      }),
    }))
    expect(apiConfigMock.getProviderConfig).toHaveBeenCalledWith('user-1', 'comfyui')
    expect(comfyClientMock.runComfyUiAudioWorkflow).toHaveBeenCalledWith({
      baseUrl: 'http://127.0.0.1:8188',
      workflowKey: 'baseaudio/音色/s2-se',
      prompt: '[冷静]你好。',
    })
    expect(result).toEqual(expect.objectContaining({
      success: true,
      voiceId: 'comfyui:voice-preview',
      audioBase64: 'comfy-audio',
      targetModel: 'baseaudio/音色/s2-se',
    }))
  })
})
