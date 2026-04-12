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
        name: 'Doctor',
        aliases: 'Psychiatrist',
        introduction: 'A calm and professional doctor.',
        profileData: JSON.stringify({
          gender: 'male',
          age_range: 'middle-aged',
          archetype: 'doctor',
          occupation: 'doctor',
          personality_tags: ['calm', 'strict'],
          visual_keywords: ['white coat', 'glasses'],
        }),
        appearances: [
          {
            changeReason: 'default',
            description: 'Wears a white coat and silver glasses.',
          },
        ],
      },
    ])
    aiRuntimeMock.executeAiTextStep.mockResolvedValue({
      text: JSON.stringify({
        enhanced_prompt: 'Medium close-up of the doctor speaking steadily, with restrained body movement and stable mouth motion.',
      }),
    })
  })

  it('returns the original prompt for non-LTX models', async () => {
    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/demo/Wan2.2',
      originalPrompt: 'doctor sits at the desk and speaks',
      panel: {
        description: 'doctor faces forward and speaks',
      },
    })

    expect(result).toEqual({
      prompt: 'doctor sits at the desk and speaks',
      enhanced: false,
      textModel: null,
    })
    expect(aiRuntimeMock.executeAiTextStep).not.toHaveBeenCalled()
  })

  it('returns the original prompt without AI enhancement when the prompt is user edited', async () => {
    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/demo/LTX2.3-demo',
      originalPrompt: 'two characters sit across a desk, no special effects',
      userEdited: true,
      panel: {
        description: 'two characters sit across a desk in an office',
      },
    })

    expect(result).toEqual({
      prompt: 'two characters sit across a desk, no special effects',
      enhanced: false,
      textModel: null,
    })
    expect(aiRuntimeMock.executeAiTextStep).not.toHaveBeenCalled()
  })

  it('passes strict verbatim dialogue instructions into the enhancement prompt', async () => {
    await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/demo/LTX2.3-fast',
      originalPrompt: 'doctor faces forward and speaks with both hands on the desk',
      panel: {
        panelIndex: 2,
        description: 'doctor faces forward and speaks with both hands on the desk',
        location: 'office',
        characters: 'Doctor',
        shotType: 'medium close-up',
        cameraMove: 'slow push-in',
        srtSegment: 'Hello Chen Ji, I need to ask you some questions.',
        clipContent: 'Late-night office dialogue scene.',
      },
      linkedVoiceLines: [
        {
          id: 'line-1',
          speaker: 'Doctor',
          content: 'Hello Chen Ji, I need to ask you some questions.',
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
    expect(promptText).toContain('Strict dialogue preservation rules:')
    expect(promptText).toContain('must say exactly')
    expect(promptText).toContain('Hello Chen Ji, I need to ask you some questions.')
  })

  it('appends the exact linked line to the final enhanced prompt', async () => {
    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/demo/LTX2.3-fast',
      originalPrompt: 'doctor faces forward and speaks with both hands on the desk',
      panel: {
        description: 'doctor faces forward and speaks with both hands on the desk',
        location: 'office',
        characters: 'Doctor',
      },
      linkedVoiceLines: [
        {
          id: 'line-1',
          speaker: 'Doctor',
          content: 'Hello Chen Ji, I need to ask you some questions.',
          audioDuration: 3030,
        },
      ],
      durationSeconds: 3.03,
      fps: 25,
      generationMode: 'normal',
    })

    expect(result).toEqual({
      prompt: 'Medium close-up of the doctor speaking steadily, with restrained body movement and stable mouth motion. The spoken dialogue must match exactly "Hello Chen Ji, I need to ask you some questions.". Match mouth movement, pauses, and timing to this exact line. Do not paraphrase, translate, or replace it.',
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
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/demo/LTX2.3-fast',
      originalPrompt: 'doctor faces forward and speaks',
      panel: {
        description: 'doctor faces forward and speaks',
      },
      linkedVoiceLines: [
        {
          id: 'line-1',
          speaker: 'Doctor',
          content: 'Hello Chen Ji, I need to ask you some questions.',
          audioDuration: 3030,
        },
      ],
      durationSeconds: 3.03,
    })

    expect(result).toEqual({
      prompt: 'doctor faces forward and speaks. The spoken dialogue must match exactly "Hello Chen Ji, I need to ask you some questions.". Match mouth movement, pauses, and timing to this exact line. Do not paraphrase, translate, or replace it.',
      enhanced: false,
      textModel: 'bailian::qwen3.5-plus',
    })
  })
})
