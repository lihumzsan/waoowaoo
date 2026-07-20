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
import { splitPromptRelayLocalSegments } from '@/lib/providers/comfyui/workflow-registry'

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
        enhanced_prompt: 'GLOBAL: The same doctor remains seated in the same office source frame. LOCAL: Medium close-up of the doctor speaking steadily, with restrained body movement and stable mouth motion.',
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
    expect(result.prompt).toContain('GLOBAL:')
    expect(result.prompt).toContain('LOCAL:')
    expect(result.prompt).toContain('The spoken dialogue must match exactly "Hello Chen Ji, I need to ask you some questions."')
    expect(result.prompt).toContain('Source-frame continuity lock')
    expect(result.prompt).toContain('Do not add new people')
    expect(result.prompt).toContain('Do not add subtitles, captions, text overlays')
    expect(result.prompt).toContain('never cut to another room, hallway, crowd, uniformed people')
  })

  it('keeps exact dialogue out of the final Smart VBVR visual prompt when reference audio is linked', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        enhanced_prompt: 'GLOBAL: The same middle-aged doctor remains seated in the same office source frame. LOCAL: The doctor faces the camera and speaks with subtle synchronized mouth motion.',
      }),
    })

    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
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
          audioUrl: 'voice.mp3',
        },
      ],
      durationSeconds: 3.03,
      fps: 25,
      generationMode: 'normal',
    })

    expect(result.enhanced).toBe(true)
    expect(result.prompt).toContain('reference audio')
    expect(result.prompt).toContain('mouth movement')
    expect(result.prompt).toContain('lower portion of the frame stays clean')
    expect(result.prompt).not.toContain('Hello Chen Ji, I need to ask you some questions.')
    expect(result.prompt).not.toContain('Do not add subtitles, captions, text overlays')
    expect(result.prompt.toLowerCase()).not.toContain('subtitles')

    const promptText = aiRuntimeMock.executeAiTextStep.mock.calls[0]?.[0]?.messages?.[0]?.content as string
    expect(promptText).toContain('reference audio')
    expect(promptText).not.toContain('must say exactly')
  })

  it('removes unsafe camera-travel wording from normal single-shot prompts', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        enhanced_prompt: 'GLOBAL: The same doctor remains seated at the same office desk. LOCAL: The doctor sits while the camera slowly orbiting the office with tiny within-frame parallax simulating a pan.',
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

  it('asks Smart VBVR automatic prompts to use GLOBAL and LOCAL structure', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        enhanced_prompt: 'GLOBAL: The same doctor remains seated in the office. LOCAL: The doctor speaks calmly with subtle mouth movement.',
      }),
    })

    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
      originalPrompt: 'doctor sits in the office and speaks',
      panel: {
        description: 'doctor sits in the office and speaks',
        characters: 'Doctor',
      },
      generationMode: 'normal',
    })

    const promptText = aiRuntimeMock.executeAiTextStep.mock.calls[0]?.[0]?.messages?.[0]?.content as string
    expect(promptText).toContain('GLOBAL:')
    expect(promptText).toContain('LOCAL:')
    expect(promptText).toContain('VBVR')
    expect(result.enhanced).toBe(true)
    expect(result.prompt).toContain('GLOBAL:')
    expect(result.prompt).toContain('LOCAL:')
  })

  it('falls back when Smart VBVR enhancement omits required GLOBAL and LOCAL structure', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        enhanced_prompt: 'The doctor speaks calmly with subtle mouth movement.',
      }),
    })

    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
      originalPrompt: 'doctor sits in the office and speaks',
      panel: {
        description: 'doctor sits in the office and speaks',
        characters: 'Doctor',
      },
      generationMode: 'normal',
    })

    const beforeContinuityLock = result.prompt.split('Source-frame continuity lock:')[0]
    expect(result.enhanced).toBe(false)
    expect(beforeContinuityLock).toContain('doctor sits in the office and speaks')
    expect(beforeContinuityLock).not.toContain('The doctor speaks calmly')
  })

  it('preserves Chinese orbit and rotation wording when the original prompt requests it', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        enhanced_prompt: 'GLOBAL: 同一名医生保持在同一间办公室源图中。LOCAL: 医生坐在书桌后说话，镜头围绕人物转圈并缓慢旋转，带出办公室空间。',
      }),
    })

    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
      originalPrompt: '医生坐在书桌后说话，镜头围绕人物转圈并缓慢旋转',
      panel: {
        description: '医生坐在书桌后说话，镜头围绕人物转圈并缓慢旋转',
        characters: '医生',
      },
      generationMode: 'normal',
    })

    const beforeContinuityLock = result.prompt.split('Source-frame continuity lock:')[0]
    expect(beforeContinuityLock).toContain('镜头围绕人物转圈并缓慢旋转')
    expect(beforeContinuityLock).not.toContain('locked-off static camera')
  })

  it('falls back to the visible prompt when Smart VBVR enhancement adds unrequested orbiting', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        enhanced_prompt: 'GLOBAL: 中年男子保持在同一间办公室源图中。LOCAL: 中年男子坐在书桌后说话，镜头围绕医生转圈并缓慢旋转，带出办公室空间。',
      }),
    })

    const originalPrompt = '中年男子坐在书桌后侧靠墙的椅子上微微抬头看向前方，嘴唇开合，正在说话，镜头缓缓推近，惨白白炽灯照着他的眼镜和脸'
    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
      originalPrompt,
      panel: {
        description: '反打近景：中年医生面向画外右侧的陈迹开口，嘴唇清楚出现在画面中央，眼镜下的视线保持平直',
        characters: '中年医生',
        cameraMove: '缓缓推近',
      },
      generationMode: 'normal',
    })

    const beforeContinuityLock = result.prompt.split('Source-frame continuity lock:')[0]
    expect(result.enhanced).toBe(false)
    expect(beforeContinuityLock).toContain(originalPrompt)
    expect(beforeContinuityLock).toContain('镜头缓缓推近')
    expect(beforeContinuityLock).not.toContain('镜头围绕医生转圈')
    expect(beforeContinuityLock).not.toContain('locked-off static camera')
    expect(result.prompt).not.toMatch(/\b(?:orbit|circl(?:e|ing)|spin(?:ning)?|rotation|360|parallax)\b/i)
    expect(result.prompt).not.toMatch(/\u955c\u5934.{0,8}(?:\u56f4\u7ed5|\u73af\u7ed5|\u8f6c\u5708|\u65cb\u8f6c)/u)
  })

  it('does not treat negative orbit constraints as requested orbit movement', async () => {
    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
      originalPrompt: [
        '中年男子坐在书桌后说话，镜头缓缓推近。',
        'Do not add orbit, circling, spinning, rotation, 360-degree movement, or extra camera travel into unseen areas.',
      ].join('\n'),
      userEdited: true,
      panel: {
        description: '中年医生坐在办公室书桌后说话',
        characters: '中年医生',
        cameraMove: '缓缓推近',
      },
      generationMode: 'normal',
    })

    expect(result.prompt).toContain('Preserve only the original prompt\'s explicitly requested camera movement')
    expect(result.prompt).not.toContain('explicitly requested orbit or rotation camera movement')
    expect(aiRuntimeMock.executeAiTextStep).not.toHaveBeenCalled()
  })

  it('falls back to the original prompt when AI enhancement drops the shot intent', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        enhanced_prompt: 'GLOBAL: A rainy street with a young woman. LOCAL: A young woman walks on a rainy street, brushes her hair, turns and waves, then walks away.',
      }),
    })

    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
      originalPrompt: 'middle-aged doctor sits behind the office desk, looks forward, opens and closes his mouth while speaking',
      panel: {
        description: 'middle-aged doctor sits behind the office desk and speaks',
        characters: 'Doctor',
      },
      generationMode: 'normal',
    })

    const beforeContinuityLock = result.prompt.split('Source-frame continuity lock:')[0]
    expect(result.enhanced).toBe(false)
    expect(beforeContinuityLock).toContain('middle-aged doctor sits behind the office desk')
    expect(beforeContinuityLock).not.toContain('rainy street')
    expect(beforeContinuityLock).not.toContain('walks away')
  })

  it('preserves continuous camera movement for the large-motion workflow profile', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        enhanced_prompt: [
          'GLOBAL: The same doctor remains in the same office source frame.',
          'LOCAL 1: The doctor steadies his hand at the desk.',
          'LOCAL 2: The doctor keeps speaking as the camera slowly pushes in across the desk.',
          'LOCAL 3: The camera reaches the closest continuous push-in while the doctor holds eye contact.',
          'LOCAL 4: The doctor settles into the final position without changing the room.',
        ].join('\n'),
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
    expect(promptText).toContain('LOCAL 1:')
    expect(promptText).toContain('LOCAL 4:')
    expect(result.prompt).toContain('camera slowly pushes in')
    expect(result.prompt).toContain('LOCAL 4:')
    expect(result.prompt.split('Source-frame continuity lock:')[0]).not.toContain('locked-off static camera')
  })

  it('keeps micro-detail prompts locked off and removes pan wording before continuity constraints', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        enhanced_prompt: 'GLOBAL: The same doctor remains in the same office source frame. LOCAL: The doctor glances down as the camera slowly pans across his glasses.',
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
        enhanced_prompt: [
          'GLOBAL: The same office and the doctor remain visible.',
          'LOCAL 1: The doctor inhales before speaking.',
          'LOCAL 2: The doctor keeps speaking as the camera slowly tracks closer.',
          'LOCAL 3: The doctor pauses and keeps eye contact.',
        ].join('\n'),
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
    expect(promptText).toContain('LOCAL 1:')
    expect(promptText).toContain('LOCAL 3:')
    expect(promptText).not.toContain('four continuous motion stages')
    expect(result.prompt).toContain('GLOBAL:')
    expect(result.prompt).toContain('LOCAL 1:')
    expect(result.prompt).toContain('LOCAL 3:')
  })

  it('uses GPT-5.5 and accepts its content-aware non-equal KJ frame plan', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        enhanced_prompt: [
          'GLOBAL: The same doctor and office remain visible.',
          'LOCAL 1: The doctor prepares to move.',
          'LOCAL 2: The doctor completes the visible motion.',
          'LOCAL 3: The doctor settles in the same office.',
        ].join('\n'),
        segment_frames: [45, 105, 75],
      }),
    })

    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/ltx23-profiles/t8-multishot-precise-promptrelay-kj-720p',
      originalPrompt: 'doctor moves one hand and then settles',
      panel: {
        description: 'doctor moves one hand and then settles',
        characters: 'Doctor',
      },
      durationSeconds: 9,
      fps: 25,
      motionStrength: 3,
      generationMode: 'normal',
    })

    const request = aiRuntimeMock.executeAiTextStep.mock.calls[0]?.[0]
    const promptText = request?.messages?.[0]?.content as string
    expect(request?.model).toBe('codex::gpt-5.5')
    expect(promptText).toContain('Target duration: 9.00 seconds.')
    expect(promptText).toContain('Frame rate: 25 fps.')
    expect(promptText).toContain('LOCAL 1:')
    expect(promptText).toContain('LOCAL 3:')
    expect(promptText).toContain('Motion strength: 3 (strong motion / intense action).')
    expect(promptText).toContain('Use exactly 3 numbered LOCAL sections for this request.')
    expect(promptText).toContain('Total frame budget: 225 frames.')
    expect(promptText).toContain('segment_frames')
    expect(promptText).toContain('When frame allocation is requested, the returned JSON object must also include segment_frames')
    expect(promptText).toMatch(/analyze the concrete action beats/i)
    expect(promptText).not.toContain('[45, 105, 75]')
    expect(promptText).not.toContain('LOCAL 1 timing: frames 0-75')
    expect(result.enhanced).toBe(true)
    expect(result.textModel).toBe('codex::gpt-5.5')
    expect(result.prompt).toContain('LENGTHS: 45, 105, 75')
  })

  it('keeps literal dialogue and subtitle prohibitions out of an enhanced KJ visual prompt', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        enhanced_prompt: [
          'GLOBAL: The same doctor and office remain visible.',
          'LOCAL 1: The doctor faces forward and says "Hello Chen Ji".',
          'LOCAL 2: The doctor continues speaking while raising one hand. Do not add subtitles, captions, readable text, or watermarks.',
          'LOCAL 3: The doctor closes his mouth and settles.',
        ].join('\n'),
        segment_frames: [45, 105, 75],
      }),
    })

    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/ltx23-profiles/t8-multishot-precise-promptrelay-kj-720p',
      originalPrompt: 'doctor faces forward and says "Hello Chen Ji" while raising one hand',
      panel: {
        description: 'doctor faces forward and speaks',
        characters: 'Doctor',
        srtSegment: 'Hello Chen Ji',
      },
      linkedVoiceLines: [
        { id: 'line-1', speaker: 'Doctor', content: 'Hello Chen Ji' },
      ],
      durationSeconds: 9,
      fps: 25,
      motionStrength: 2,
      generationMode: 'normal',
      continuity: {
        panelId: 'panel-kj-dialogue',
        panelIndex: 0,
        sourceText: 'Hello Chen Ji',
        currentAction: 'The doctor faces forward and raises one hand while speaking.',
        location: 'office',
        shotType: 'frontal medium close-up',
        cameraMove: 'locked camera',
        sceneType: 'dialogue',
        characters: [{ name: 'Doctor', appearance: 'white coat', slot: 'behind desk' }],
        props: 'desk',
        previous: null,
        next: null,
        dialogueLines: [],
        targetDurationSeconds: 9,
        allowedActions: ['lip movement', 'raise one hand'],
        forbiddenAdditions: ['new people', 'subtitles'],
      },
    })

    const promptText = aiRuntimeMock.executeAiTextStep.mock.calls[0]?.[0]?.messages?.[0]?.content as string
    expect(promptText).toMatch(/do not include literal dialogue|do not copy literal dialogue/i)
    expect(promptText).toMatch(/visible lip|mouth movement/i)
    expect(promptText).toMatch(/negative conditioning/i)
    expect(promptText).not.toContain('Hello Chen Ji')
    expect(result.enhanced).toBe(true)
    expect(result.prompt).toContain('LENGTHS: 45, 105, 75')
    expect(result.prompt).toMatch(/lip movement/i)
    expect(result.prompt).toContain('raising one hand')
    expect(result.prompt).not.toContain('Hello Chen Ji')
    expect(result.prompt).not.toMatch(/subtitles?|captions?|readable text|watermarks?/i)
    expect(result.prompt).not.toMatch(/spoken dialogue must match exactly/i)
  })

  it.each([
    ['AI fallback', false],
    ['user-edited fallback', true],
  ])('sanitizes literal dialogue from the KJ %s path', async (_label, userEdited) => {
    if (!userEdited) {
      aiRuntimeMock.executeAiTextStep.mockRejectedValueOnce(new Error('AI unavailable'))
    }

    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/ltx23-profiles/t8-multishot-precise-promptrelay-kj-720p',
      originalPrompt: 'doctor says "Hello Chen Ji" while raising one hand. Do not add subtitles or captions.',
      panel: { description: 'doctor faces forward and speaks', characters: 'Doctor' },
      linkedVoiceLines: [
        { id: 'line-1', speaker: 'Doctor', content: 'Hello Chen Ji' },
      ],
      durationSeconds: 9,
      fps: 25,
      motionStrength: 2,
      generationMode: 'normal',
      userEdited,
    })

    expect(result.enhanced).toBe(false)
    expect(result.prompt).toContain('GLOBAL:')
    expect(result.prompt).toContain('LOCAL 3:')
    expect(result.prompt).toMatch(/lip movement/i)
    expect(result.prompt).toContain('raising one hand')
    expect(result.prompt).not.toContain('Hello Chen Ji')
    expect(result.prompt).not.toMatch(/subtitles?|captions?/i)
    expect(result.prompt.match(/LENGTHS:/g)).toHaveLength(1)
  })

  it.each([
    ['equal allocation', [75, 75, 75]],
    ['wrong segment count', [100, 125]],
    ['non-integer frames', [45.5, 104.5, 75]],
    ['wrong total', [45, 100, 75]],
  ])('rejects a KJ Codex %s', async (_label, segmentFrames) => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        enhanced_prompt: [
          'GLOBAL: The same doctor and office remain visible.',
          'LOCAL 1: The doctor prepares to move.',
          'LOCAL 2: The doctor completes the visible motion.',
          'LOCAL 3: The doctor settles in the same office.',
        ].join('\n'),
        segment_frames: segmentFrames,
      }),
    })

    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/ltx23-profiles/t8-multishot-precise-promptrelay-kj-720p',
      originalPrompt: 'doctor moves one hand and then settles',
      panel: { description: 'doctor moves one hand and then settles', characters: 'Doctor' },
      durationSeconds: 9,
      fps: 25,
      motionStrength: 2,
      generationMode: 'normal',
    })

    expect(result.enhanced).toBe(false)
    const fallbackFrames = result.prompt.match(/LENGTHS:\s*([\d,\s]+)/)?.[1]
      ?.split(',')
      .map((value) => Number(value.trim())) ?? []
    expect(fallbackFrames).toHaveLength(3)
    expect(fallbackFrames.reduce((sum, value) => sum + value, 0)).toBe(225)
    expect(new Set(fallbackFrames).size).toBeGreaterThan(1)
  })

  it('rejects a KJ Codex response whose LOCAL count does not match the requested timeline', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        enhanced_prompt: [
          'GLOBAL: The same doctor and office remain visible.',
          'LOCAL 1: The doctor starts the hand motion.',
          'LOCAL 2: The doctor continues the hand motion.',
          'LOCAL 3: The doctor settles in the same office.',
        ].join('\n'),
        segment_frames: [50, 100, 100, 50],
      }),
    })

    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/ltx23-profiles/t8-multishot-precise-promptrelay-kj-720p',
      originalPrompt: 'doctor moves one hand and then settles',
      panel: {
        description: 'doctor moves one hand and then settles',
        characters: 'Doctor',
      },
      durationSeconds: 12,
      fps: 25,
      motionStrength: 2,
      generationMode: 'normal',
    })

    expect(result.enhanced).toBe(false)
    expect(result.prompt).toContain('GLOBAL:')
    expect(result.prompt).toContain('LOCAL 1:')
    expect(result.prompt).toContain('LOCAL 4:')
    expect(result.prompt).not.toContain('LOCAL 5:')
  })

  it.each([
    [
      'an extra unnumbered LOCAL marker',
      'GLOBAL: The same doctor and office remain visible.\nLOCAL: unexpected beat\nLOCAL 1: prepare\nLOCAL 2: move\nLOCAL 3: settle',
    ],
    [
      'an empty numbered section',
      'GLOBAL: The same doctor and office remain visible.\nLOCAL 1: prepare\nLOCAL 2:\nLOCAL 3: settle',
    ],
    [
      'an embedded relay separator',
      'GLOBAL: The same doctor and office remain visible.\nLOCAL 1: prepare\nLOCAL 2: move | unexpected beat\nLOCAL 3: settle',
    ],
    [
      'an explicit LENGTHS override',
      'GLOBAL: The same doctor and office remain visible.\nLOCAL 1: prepare\nLOCAL 2: move\nLOCAL 3: settle\nLENGTHS: 25,100,100',
    ],
  ])('rejects KJ Codex output with %s', async (_label, enhancedPrompt) => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({ enhanced_prompt: enhancedPrompt, segment_frames: [45, 105, 75] }),
    })

    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/ltx23-profiles/t8-multishot-precise-promptrelay-kj-720p',
      originalPrompt: 'doctor moves one hand and then settles',
      panel: { description: 'doctor moves one hand and then settles', characters: 'Doctor' },
      durationSeconds: 9,
      fps: 25,
      motionStrength: 2,
      generationMode: 'normal',
    })

    expect(result.enhanced).toBe(false)
    expect(result.prompt).toContain('LOCAL 1:')
    expect(result.prompt).toContain('LOCAL 3:')
  })

  it('sanitizes relay separators from the KJ structured fallback', async () => {
    aiRuntimeMock.executeAiTextStep.mockRejectedValueOnce(new Error('AI unavailable'))

    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/ltx23-profiles/t8-multishot-precise-promptrelay-kj-720p',
      originalPrompt: 'doctor raises one hand | then settles',
      panel: { description: 'doctor raises one hand | then settles', characters: 'Doctor' },
      durationSeconds: 9,
      fps: 25,
      motionStrength: 2,
      generationMode: 'normal',
    })

    expect(result.enhanced).toBe(false)
    expect(result.prompt).not.toContain('|')
    expect(splitPromptRelayLocalSegments(result.prompt)).toHaveLength(3)
  })

  it('sanitizes PromptRelay syntax appended from KJ dialogue constraints', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        enhanced_prompt: [
          'GLOBAL: The same doctor and office remain visible.',
          'LOCAL 1: The doctor prepares to speak.',
          'LOCAL 2: The doctor speaks while facing forward.',
          'LOCAL 3: The doctor settles in the same office.',
        ].join('\n'),
        segment_frames: [45, 105, 75],
      }),
    })

    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/ltx23-profiles/t8-multishot-precise-promptrelay-kj-720p',
      originalPrompt: 'doctor speaks while facing forward',
      panel: { description: 'doctor speaks while facing forward', characters: 'Doctor' },
      linkedVoiceLines: [
        { id: 'line-1', speaker: 'Doctor', content: 'Ready | LOCAL: now LENGTHS: 1,2,1' },
      ],
      durationSeconds: 9,
      fps: 25,
      motionStrength: 2,
      generationMode: 'normal',
    })

    expect(result.enhanced).toBe(true)
    expect(result.prompt).not.toContain('|')
    expect(result.prompt).not.toMatch(/\bLOCAL\s*[:\uFF1A]/i)
    expect(result.prompt.match(/\bLENGTHS\s*[:\uFF1A]/gi)).toHaveLength(1)
    expect(result.prompt).toContain('LENGTHS: 45, 105, 75')
    expect(splitPromptRelayLocalSegments(result.prompt)).toHaveLength(3)
  })

  it('accepts four numbered local sections for large-motion PromptRelay profiles', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        enhanced_prompt: [
          'GLOBAL: The same doctor and office remain fixed.',
          'LOCAL 1: The doctor prepares to lean forward.',
          'LOCAL 2: The doctor leans forward across the desk.',
          'LOCAL 3: The doctor reaches the strongest forward motion.',
          'LOCAL 4: The doctor settles while keeping eye contact.',
        ].join('\n'),
      }),
    })

    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/ltx23-profiles/t8-single-image-large-motion-4stage',
      originalPrompt: 'doctor leans forward across the office desk',
      panel: {
        description: 'doctor leans forward across the office desk',
        characters: 'Doctor',
      },
      generationMode: 'normal',
    })

    expect(result.enhanced).toBe(true)
    expect(result.prompt).toContain('LOCAL 1:')
    expect(result.prompt).toContain('LOCAL 4:')
  })

  it('accepts numbered local sections for long PromptRelay profiles', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        enhanced_prompt: [
          'GLOBAL: The same doctor and office remain visible.',
          'LOCAL 1: The doctor inhales before speaking.',
          'LOCAL 2: The doctor speaks the first phrase.',
          'LOCAL 3: The doctor pauses and keeps eye contact.',
        ].join('\n'),
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

    expect(result.enhanced).toBe(true)
    expect(result.prompt).toContain('LOCAL 1:')
    expect(result.prompt).toContain('LOCAL 3:')
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
      modelKey: 'comfyui::basevideo/ltx23-profiles/goon-first-last-frame-2stage',
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

  it('returns structured Smart VBVR fallback instead of raw continuity packet for audio-backed talking-head prompts', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: 'not-json',
    })

    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
      originalPrompt: [
        'Panel continuity packet:',
        'Mode: single-shot image-to-video.',
        'Current shot action: middle-aged doctor sits behind the desk, leans slightly forward, and speaks calmly to camera.',
        'Hard constraints:',
        'Do not add new people, crowds, guards, police, subtitles, or profile turns.',
      ].join('\n'),
      panel: {
        panelIndex: 2,
        shotType: 'frontal close-up',
        cameraMove: 'slow push-in',
        description: 'The doctor faces the camera and speaks with visible lips.',
        location: 'night office',
        characters: '[{"name":"Doctor"}]',
        props: null,
        srtSegment: null,
        sceneType: null,
        clipContent: null,
      },
      linkedVoiceLines: [
        {
          id: 'voice-line-1',
          speaker: 'Doctor',
          content: 'Hello Chen Ji, I need to ask you some questions.',
          audioDuration: 10342,
          audioUrl: 'audio/doctor.wav',
        },
      ],
      durationSeconds: 12,
      fps: 25,
      audioTiming: {
        mode: 'match_audio',
        selectedVoiceLineIds: ['voice-line-1'],
        matchedVoiceLineIds: ['voice-line-1'],
        sourceDurationMs: 10342,
        audioDurationSeconds: 10.34,
        targetDurationSeconds: 12,
        targetFrameCount: 300,
        fps: 25,
        maxDurationSeconds: 20,
        preRollSeconds: 0.5,
        postRollSeconds: 1.16,
        dialogueStartSeconds: 0.5,
        dialogueEndSeconds: 10.84,
        timingStrategy: 'context_aware_audio',
        reason: 'context-aware audio timing',
        capped: false,
        canGenerate: true,
      },
      generationMode: 'normal',
      artStyle: 'realistic',
      userEdited: false,
      continuity: {
        panelId: 'panel-3',
        panelIndex: 2,
        sourceText: 'The doctor faces the camera and speaks with visible lips.',
        currentAction: 'middle-aged doctor sits behind the desk, leans slightly forward, and speaks calmly to camera.',
        location: 'night office',
        shotType: 'frontal close-up',
        cameraMove: 'slow push-in',
        sceneType: 'dialogue',
        characters: [{ name: 'Doctor', appearance: 'default', slot: 'behind the desk' }],
        props: 'desk',
        previous: null,
        next: null,
        dialogueLines: [],
        targetDurationSeconds: 12,
        allowedActions: ['subtle mouth movement', 'tiny facial motion'],
        forbiddenAdditions: ['new people', 'crowds', 'guards', 'police', 'subtitles', 'profile turns'],
      },
    })

    expect(result.prompt).toContain('GLOBAL:')
    expect(result.prompt).toContain('LOCAL:')
    expect(result.prompt).not.toContain('Panel continuity packet')
    expect(result.prompt).not.toContain('Hard constraints')
    expect(result.prompt.toLowerCase()).not.toContain('crowd')
    expect(result.prompt.toLowerCase()).not.toContain('guards')
    expect(result.prompt.toLowerCase()).not.toContain('police')
    expect(result.prompt.toLowerCase()).not.toContain('subtitles')
    expect(result.prompt.toLowerCase()).not.toContain('profile')
  })

  it('preserves off-camera direction in Smart VBVR audio fallback prompts', async () => {
    aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
      text: 'not-json',
    })

    const result = await enhanceLtx23VideoPrompt({
      userId: 'user-1',
      locale: 'en',
      projectId: 'project-1',
      modelKey: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
      originalPrompt: 'young man sits near the right-side window, looks toward the window, and speaks softly',
      panel: {
        panelIndex: 33,
        shotType: 'right-side window close-up',
        cameraMove: 'slow push-in',
        description: 'young man looks toward the right-side window and speaks softly',
        location: 'night office',
        characters: '[{"name":"Chen Ji"}]',
        props: '',
        srtSegment: null,
        sceneType: null,
        clipContent: null,
      },
      linkedVoiceLines: [
        {
          id: 'voice-line-33',
          speaker: 'Chen Ji',
          content: 'That does sound like the case.',
          audioDuration: 3900,
          audioUrl: 'audio/chen-ji.wav',
        },
      ],
      durationSeconds: 5,
      fps: 25,
      generationMode: 'normal',
      continuity: {
        panelId: 'panel-33',
        panelIndex: 33,
        sourceText: 'young man looks toward the right-side window and speaks softly',
        currentAction: 'young man sits near the right-side window, looks toward the window, and speaks softly',
        location: 'night office',
        shotType: 'right-side window close-up',
        cameraMove: 'slow push-in',
        sceneType: 'dialogue',
        characters: [{ name: 'Chen Ji', appearance: 'default', slot: 'near the right-side window' }],
        props: '',
        previous: null,
        next: null,
        dialogueLines: [],
        targetDurationSeconds: 5,
        allowedActions: ['subtle mouth movement', 'tiny facial motion'],
        forbiddenAdditions: ['subtitles', 'captions'],
      },
    })

    expect(result.prompt).toContain('GLOBAL:')
    expect(result.prompt).toContain('LOCAL:')
    expect(result.prompt).toContain('looks toward the window')
    expect(result.prompt).toContain('requested head and gaze direction')
    expect(result.prompt).toContain('lower portion of the frame stays clean')
    expect(result.prompt).not.toContain('stays frontal to camera')
    expect(result.prompt).not.toContain('That does sound like the case.')
    expect(result.prompt.toLowerCase()).not.toContain('subtitles')
    expect(result.prompt.toLowerCase()).not.toContain('captions')
  })
})
