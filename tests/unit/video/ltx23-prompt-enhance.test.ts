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
    configServiceMock.getProjectModelConfig.mockResolvedValue({ analysisModel: 'openrouter::x-ai/grok-4.1-fast' })
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

    expect(result.enhanced).toBe(false)
    expect(result.textModel).toBeNull()
    expect(result.prompt).toContain('two characters sit across a desk, no special effects')
    expect(result.prompt).toContain('Source-frame continuity lock')
    expect(result.prompt).toContain('Do not add new people')
    expect(result.prompt).toContain('Keep the final frame close to the source image')
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
      durationSeconds: 4.7,
      fps: 25,
      audioTiming: {
        mode: 'match_audio',
        selectedVoiceLineIds: ['line-1'],
        matchedVoiceLineIds: ['line-1'],
        sourceDurationMs: 3030,
        audioDurationSeconds: 3.03,
        targetDurationSeconds: 4.7,
        targetFrameCount: 118,
        fps: 25,
        maxDurationSeconds: 10,
        preRollSeconds: 0.7,
        postRollSeconds: 0.97,
        dialogueStartSeconds: 0.7,
        dialogueEndSeconds: 3.73,
        timingStrategy: 'context_aware_audio',
        reason: 'context-aware audio timing',
        capped: false,
        canGenerate: true,
      },
      generationMode: 'normal',
      artStyle: 'cinematic realism',
    })

    const promptText = aiRuntimeMock.executeAiTextStep.mock.calls[0]?.[0]?.messages?.[0]?.content as string
    expect(promptText).toContain('Linked audio count: 1')
    expect(promptText).toContain('Audio duration: 3.03 seconds.')
    expect(promptText).toContain('Context-aware target video duration: 4.70 seconds.')
    expect(promptText).toContain('[0.00-0.70] pre-roll emotional setup')
    expect(promptText).toContain('Strict dialogue preservation rules:')
    expect(promptText).toContain('must say exactly')
    expect(promptText).toContain('Hello Chen Ji, I need to ask you some questions.')
    expect(promptText).toContain('The source frame and current panel are authoritative.')
    expect(promptText).toContain('Do not introduce new people')
    expect(promptText).toContain('Keep the source-frame composition locked.')
  })

  it('resolves character profiles from JSON object panel characters', async () => {
    await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/demo/LTX2.3-fast',
      originalPrompt: 'doctor pushes his glasses',
      panel: {
        description: 'doctor pushes his glasses',
        characters: JSON.stringify([{ name: 'Doctor', appearance: 'default', slot: 'behind the desk' }]),
      },
    })

    expect(prismaMock.prisma.novelPromotionCharacter.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        name: { in: ['Doctor'] },
      }),
    }))
    const promptText = aiRuntimeMock.executeAiTextStep.mock.calls[0]?.[0]?.messages?.[0]?.content as string
    expect(promptText).toContain('Name: Doctor')
    expect(promptText).not.toContain('No structured character profile was found')
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

    expect(result.enhanced).toBe(true)
    expect(result.textModel).toBe('openrouter::x-ai/grok-4.1-fast')
    expect(result.prompt).toContain('Medium close-up of the doctor speaking steadily')
    expect(result.prompt).toContain('The spoken dialogue must match exactly "Hello Chen Ji, I need to ask you some questions."')
    expect(result.prompt).toContain('Source-frame continuity lock')
    expect(result.prompt).toContain('Do not add new people')
  })

  it('removes unsafe camera-travel wording from normal single-shot prompts', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        enhanced_prompt: 'The doctor sits while the camera slowly orbiting the office with tiny within-frame parallax simulating a pan.',
      }),
    })

    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/demo/LTX2.3-fast',
      originalPrompt: 'doctor sits at the desk',
      panel: {
        description: 'doctor sits at the desk',
        characters: 'Doctor',
      },
      generationMode: 'normal',
    })

    expect(result.prompt).toContain('locked-off static camera')
    expect(result.prompt.split('Source-frame continuity lock:')[0]).not.toMatch(/\b(orbiting|parallax)\b/i)
  })

  it('preserves continuous camera movement for the large-motion workflow profile', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        enhanced_prompt: 'The doctor steadies his hand as the camera slowly pushes in across the desk.',
      }),
    })

    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/ltx23-profiles/t8-single-image-large-motion-4stage',
      originalPrompt: 'doctor sits at the desk',
      panel: {
        description: 'doctor sits at the desk',
        characters: 'Doctor',
      },
      generationMode: 'normal',
    })

    const promptText = aiRuntimeMock.executeAiTextStep.mock.calls[0]?.[0]?.messages?.[0]?.content as string
    expect(promptText).toContain('Workflow profile: large_motion_single_image.')
    expect(promptText).toContain('four continuous motion stages')
    expect(result.prompt).toContain('camera slowly pushes in')
    expect(result.prompt.split('Source-frame continuity lock:')[0]).not.toContain('locked-off static camera')
  })

  it('keeps micro-detail prompts locked off and removes pan wording before continuity constraints', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        enhanced_prompt: 'The doctor glances down as the camera slowly pans across his glasses.',
      }),
    })

    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/ltx23-profiles/t8-sulphur2-promptrelay-micro',
      originalPrompt: 'doctor makes a tiny expression',
      panel: {
        description: 'doctor makes a tiny expression',
        characters: 'Doctor',
      },
      generationMode: 'normal',
    })

    const beforeContinuityLock = result.prompt.split('Source-frame continuity lock:')[0]
    expect(result.prompt).toContain('locked-off static camera')
    expect(beforeContinuityLock).not.toMatch(/\b(?:pan|panning|pans)\b/i)
  })

  it('requires explicit PromptRelay sections for long PromptRelay workflow profiles', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        enhanced_prompt: 'GLOBAL: The same office and the doctor remain visible. LOCAL: The doctor keeps speaking as the camera slowly tracks closer.',
      }),
    })

    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/ltx23-profiles/damaicha-long-video-promptrelay',
      originalPrompt: 'doctor speaks through a long quiet moment',
      panel: {
        description: 'doctor speaks through a long quiet moment',
        characters: 'Doctor',
      },
      generationMode: 'normal',
    })

    const promptText = aiRuntimeMock.executeAiTextStep.mock.calls[0]?.[0]?.messages?.[0]?.content as string
    expect(promptText).toContain('Workflow profile: long_promptrelay.')
    expect(promptText).toContain('GLOBAL:')
    expect(promptText).toContain('LOCAL:')
    expect(promptText).not.toContain('four continuous motion stages')
    expect(result.prompt).toContain('GLOBAL:')
    expect(result.prompt).toContain('LOCAL:')
  })

  it('preserves continuous camera movement for first-to-last-frame profiles without PromptRelay requirements', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        enhanced_prompt: 'The doctor looks up as the camera slowly pans toward the ending frame.',
      }),
    })

    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/ltx23-profiles/t8-smooth-first-last-frame',
      originalPrompt: 'doctor moves from start frame to end frame',
      panel: {
        description: 'doctor moves from start frame to end frame',
        characters: 'Doctor',
      },
      generationMode: 'firstlastframe',
    })

    const promptText = aiRuntimeMock.executeAiTextStep.mock.calls[0]?.[0]?.messages?.[0]?.content as string
    expect(promptText).toContain('Workflow profile: first_last_frame.')
    expect(promptText).not.toContain('four continuous motion stages')
    expect(promptText).not.toContain('must include explicit GLOBAL: and LOCAL: sections')
    expect(result.prompt).toContain('camera slowly pans')
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

    expect(result.enhanced).toBe(false)
    expect(result.textModel).toBe('openrouter::x-ai/grok-4.1-fast')
    expect(result.prompt).toContain('doctor faces forward and speaks')
    expect(result.prompt).toContain('The spoken dialogue must match exactly "Hello Chen Ji, I need to ask you some questions."')
    expect(result.prompt).toContain('Source-frame continuity lock')
  })
})
