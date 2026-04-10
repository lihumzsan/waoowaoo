import { beforeEach, describe, expect, it, vi } from 'vitest'

const aiRuntimeMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(),
}))

const apiConfigMock = vi.hoisted(() => ({
  getModelsByType: vi.fn(),
  getProviderKey: vi.fn((providerId: string) => providerId.split(':')[0] || providerId),
}))

const configServiceMock = vi.hoisted(() => ({
  composeModelKey: vi.fn((provider: string, modelId: string) => `${provider}::${modelId}`),
  getProjectModelConfig: vi.fn(),
  getUserModelConfig: vi.fn(),
}))

const prismaMock = vi.hoisted(() => ({
  prisma: {
    novelPromotionCharacter: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/ai-runtime', () => aiRuntimeMock)
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/prisma', () => prismaMock)

import { enhanceLtx23VideoPrompt } from '@/lib/video-duration/ltx23-prompt-enhance'

describe('ltx23 video prompt enhance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configServiceMock.getProjectModelConfig.mockResolvedValue({ analysisModel: 'bailian::qwen3.5-plus' })
    configServiceMock.getUserModelConfig.mockResolvedValue({ analysisModel: null })
    apiConfigMock.getModelsByType.mockResolvedValue([
      {
        provider: 'bailian',
        modelId: 'qwen3.5-plus',
        type: 'llm',
      },
    ])
    prismaMock.prisma.novelPromotionCharacter.findMany.mockResolvedValue([
      {
        name: '中年医生',
        aliases: '医生',
        introduction: '一位冷静克制的专业医生。',
        profileData: JSON.stringify({
          gender: '男',
          age_range: '中年',
          archetype: '专业医生',
          occupation: '医生',
          personality_tags: ['严谨', '冷静'],
          visual_keywords: ['白大褂', '银框眼镜'],
        }),
        appearances: [
          {
            changeReason: '默认',
            description: '穿白大褂，佩戴银框眼镜，说话克制稳重。',
          },
        ],
      },
    ])
    aiRuntimeMock.executeAiTextStep.mockResolvedValue({
      text: JSON.stringify({
        enhanced_prompt: '固定近景，中年医生面向前方说话，口型稳定贴合台词节奏，动作克制自然。',
      }),
    })
  })

  it('returns the original prompt for non-LTX models', async () => {
    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/图生视频/Wan2.2',
      originalPrompt: '中年医生坐在桌前说话',
      panel: {
        description: '中年医生面向前方开口说话',
      },
    })

    expect(result).toEqual({
      prompt: '中年医生坐在桌前说话',
      enhanced: false,
      textModel: null,
    })
    expect(aiRuntimeMock.executeAiTextStep).not.toHaveBeenCalled()
  })

  it('passes strict verbatim dialogue instructions into the enhancement prompt', async () => {
    await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/图生视频/LTX2.3图生视频快速版',
      originalPrompt: '中年医生面向前方开口说话，双手放在桌面上',
      panel: {
        panelIndex: 2,
        description: '中年医生面向前方开口说话，双手放在桌面上',
        location: '办公室',
        characters: '中年医生',
        shotType: '平视近景',
        cameraMove: '缓缓推近',
        srtSegment: '陈迹你好，我现在需要问你一些问题。',
        clipContent: '夜晚办公室里的对话场景。',
      },
      linkedVoiceLines: [
        {
          id: 'line-1',
          speaker: '中年医生',
          content: '陈迹你好，我现在需要问你一些问题。',
          audioDuration: 3030,
        },
      ],
      durationSeconds: 3.03,
      fps: 25,
      generationMode: 'normal',
      artStyle: 'cinematic realism',
    })

    const promptText = aiRuntimeMock.executeAiTextStep.mock.calls[0]?.[0]?.messages?.[0]?.content as string
    expect(promptText).toContain('Linked audio count: 1')
    expect(promptText).toContain('Target video duration from linked audio: 3.03 seconds.')
    expect(promptText).toContain('严格台词约束')
    expect(promptText).toContain('必须逐字保留到最终视频提示词里')
    expect(promptText).toContain('中年医生必须逐字说出：“陈迹你好，我现在需要问你一些问题。”')
  })

  it('appends the exact linked line to the final enhanced prompt', async () => {
    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/图生视频/LTX2.3图生视频快速版',
      originalPrompt: '中年医生面向前方开口说话，双手放在桌面上',
      panel: {
        description: '中年医生面向前方开口说话，双手放在桌面上',
        location: '办公室',
        characters: '中年医生',
      },
      linkedVoiceLines: [
        {
          id: 'line-1',
          speaker: '中年医生',
          content: '陈迹你好，我现在需要问你一些问题。',
          audioDuration: 3030,
        },
      ],
      durationSeconds: 3.03,
      fps: 25,
      generationMode: 'normal',
    })

    expect(result).toEqual({
      prompt: '固定近景，中年医生面向前方说话，口型稳定贴合台词节奏，动作克制自然。 对白必须严格说出“陈迹你好，我现在需要问你一些问题。”，口型、停顿与节奏贴合这句台词，不得改写、翻译或替换。',
      enhanced: true,
      textModel: 'bailian::qwen3.5-plus',
    })
  })

  it('falls back to the original prompt and still preserves the exact linked line when model output is invalid', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: 'not-json',
    })

    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/图生视频/LTX2.3图生视频快速版',
      originalPrompt: '中年医生面向前方开口说话',
      panel: {
        description: '中年医生面向前方开口说话',
      },
      linkedVoiceLines: [
        {
          id: 'line-1',
          speaker: '中年医生',
          content: '陈迹你好，我现在需要问你一些问题。',
          audioDuration: 3030,
        },
      ],
      durationSeconds: 3.03,
    })

    expect(result).toEqual({
      prompt: '中年医生面向前方开口说话。对白必须严格说出“陈迹你好，我现在需要问你一些问题。”，口型、停顿与节奏贴合这句台词，不得改写、翻译或替换。',
      enhanced: false,
      textModel: 'bailian::qwen3.5-plus',
    })
  })
})
