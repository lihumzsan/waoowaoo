import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  novelPromotionVoiceLine: {
    findUnique: vi.fn(),
    update: vi.fn(async () => undefined),
  },
  novelPromotionProject: {
    findUnique: vi.fn(),
  },
  novelPromotionEpisode: {
    findUnique: vi.fn(),
  },
}))

const resolveModelSelectionOrSingleMock = vi.hoisted(() => vi.fn())
const getProviderKeyMock = vi.hoisted(() => vi.fn((providerId: string) => providerId))
const getAudioApiKeyMock = vi.hoisted(() => vi.fn())

const normalizeToBase64ForGenerationMock = vi.hoisted(() => vi.fn())
const extractStorageKeyMock = vi.hoisted(() => vi.fn())
const getSignedUrlMock = vi.hoisted(() => vi.fn((storageKey: string) => `signed://${storageKey}`))
const toFetchableUrlMock = vi.hoisted(() => vi.fn((url: string) => url))
const uploadObjectMock = vi.hoisted(() => vi.fn(async () => 'voice/storage/line-1.wav'))
const resolveStorageKeyFromMediaValueMock = vi.hoisted(() => vi.fn())
const synthesizeWithBailianTTSMock = vi.hoisted(() => vi.fn())
const falSubscribeMock = vi.hoisted(() => vi.fn())
const getProviderConfigMock = vi.hoisted(() => vi.fn())
const runComfyUiAudioWorkflowMock = vi.hoisted(() => vi.fn())
const buildComfyUiLineRenderTextMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/api-config', () => ({
  getAudioApiKey: getAudioApiKeyMock,
  getProviderConfig: getProviderConfigMock,
  getProviderKey: getProviderKeyMock,
  resolveModelSelectionOrSingle: resolveModelSelectionOrSingleMock,
}))

vi.mock('@/lib/media/outbound-image', () => ({
  normalizeToBase64ForGeneration: normalizeToBase64ForGenerationMock,
}))

vi.mock('@/lib/storage', () => ({
  extractStorageKey: extractStorageKeyMock,
  getSignedUrl: getSignedUrlMock,
  toFetchableUrl: toFetchableUrlMock,
  uploadObject: uploadObjectMock,
}))

vi.mock('@/lib/media/service', () => ({
  resolveStorageKeyFromMediaValue: resolveStorageKeyFromMediaValueMock,
}))

vi.mock('@/lib/providers/bailian', () => ({
  synthesizeWithBailianTTS: synthesizeWithBailianTTSMock,
}))

vi.mock('@/lib/providers/comfyui/client', () => ({
  runComfyUiAudioWorkflow: runComfyUiAudioWorkflowMock,
}))

vi.mock('@/lib/voice/generate-voice-line-context', () => ({
  buildComfyUiLineRenderText: buildComfyUiLineRenderTextMock,
}))

vi.mock('@fal-ai/client', () => ({
  fal: {
    config: vi.fn(),
    subscribe: falSubscribeMock,
  },
}))

import { generateVoiceLine } from '@/lib/voice/generate-voice-line'

const COMFYUI_MULTI_SPEAKER_MODEL_ID = 'baseaudio/澶氫汉/LongCat-two'

describe('generate voice line with bailian provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const audioBytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

    prismaMock.novelPromotionVoiceLine.findUnique.mockResolvedValue({
      id: 'line-1',
      episodeId: 'episode-1',
      speaker: 'Narrator',
      content: 'hello world',
      emotionPrompt: null,
      emotionStrength: null,
      lineIndex: 1,
      matchedStoryboardId: null,
      matchedPanelIndex: null,
    })
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      characters: [],
    })
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
      speakerVoices: JSON.stringify({
        Narrator: {
          audioUrl: 'voice/reference.wav',
          voiceId: 'voice_abc123',
        },
      }),
      voiceLines: [],
      storyboards: [],
    })

    resolveModelSelectionOrSingleMock.mockResolvedValue({
      provider: 'bailian',
      modelId: 'qwen3-tts-vd-2026-01-26',
      modelKey: 'bailian::qwen3-tts-vd-2026-01-26',
      mediaType: 'audio',
    })

    getProviderConfigMock.mockResolvedValue({
      id: 'bailian',
      name: 'Alibaba Bailian',
      apiKey: 'bl-key',
    })
    synthesizeWithBailianTTSMock.mockResolvedValue({
      success: true,
      audioData: Buffer.from(audioBytes),
      audioDuration: 1,
    })
  })

  it('uses speaker voiceId to generate and persists uploaded audio', async () => {
    const result = await generateVoiceLine({
      projectId: 'project-1',
      episodeId: 'episode-1',
      lineId: 'line-1',
      userId: 'user-1',
      audioModel: 'bailian::qwen3-tts-vd-2026-01-26',
    })

    expect(getProviderConfigMock).toHaveBeenCalledWith('user-1', 'bailian')
    expect(synthesizeWithBailianTTSMock).toHaveBeenCalledWith({
      text: 'hello world',
      voiceId: 'voice_abc123',
      modelId: 'qwen3-tts-vd-2026-01-26',
      languageType: 'Chinese',
    }, 'bl-key')
    expect(uploadObjectMock).toHaveBeenCalledTimes(1)
    expect(prismaMock.novelPromotionVoiceLine.update).toHaveBeenCalledWith({
      where: { id: 'line-1' },
      data: {
        audioUrl: 'voice/storage/line-1.wav',
        audioDuration: 1,
      },
    })
    expect(result).toEqual({
      lineId: 'line-1',
      audioUrl: 'signed://voice/storage/line-1.wav',
      storageKey: 'voice/storage/line-1.wav',
      audioDuration: 1,
    })
  })

  it('fails explicitly when bailian speaker binding only has uploaded audio', async () => {
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValueOnce({
      speakerVoices: JSON.stringify({
        Narrator: {
          audioUrl: 'voice/reference.wav',
        },
      }),
    })

    await expect(
      generateVoiceLine({
        projectId: 'project-1',
        episodeId: 'episode-1',
        lineId: 'line-1',
        userId: 'user-1',
        audioModel: 'bailian::qwen3-tts-vd-2026-01-26',
      }),
    ).rejects.toThrow('QwenTTS')

    expect(synthesizeWithBailianTTSMock).not.toHaveBeenCalled()
    expect(uploadObjectMock).not.toHaveBeenCalled()
  })

  it('maps bailian invalid parameter to a qwen voice guidance error', async () => {
    synthesizeWithBailianTTSMock.mockResolvedValueOnce({
      success: false,
      error: 'BAILIAN_TTS_FAILED(400): InvalidParameter',
    })

    await expect(
      generateVoiceLine({
        projectId: 'project-1',
        episodeId: 'episode-1',
        lineId: 'line-1',
        userId: 'user-1',
        audioModel: 'bailian::qwen3-tts-vd-2026-01-26',
      }),
    ).rejects.toThrow('QwenTTS')

    expect(uploadObjectMock).not.toHaveBeenCalled()
  })
})

describe('generate voice line with comfyui provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const audioBytes = Uint8Array.from([82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0, 0, 1, 0, 1, 0, 64, 31, 0, 0, 128, 62, 0, 0, 2, 0, 16, 0, 100, 97, 116, 97, 0, 0, 0, 0])

    prismaMock.novelPromotionVoiceLine.findUnique.mockResolvedValue({
      id: 'line-1',
      episodeId: 'episode-1',
      speaker: 'SpeakerA',
      content: 'test voice line',
      emotionPrompt: null,
      emotionStrength: null,
      lineIndex: 1,
      matchedStoryboardId: 'storyboard-1',
      matchedPanelIndex: 0,
    })
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      characters: [
        {
          name: 'SpeakerA',
          customVoiceUrl: 'images/voice/custom/project-1/chenji.wav',
          voiceId: 'comfyui:c7738c90f45e2de0e4026de2',
          voiceType: 'designed',
          aliases: null,
          introduction: 'steady young man',
          profileData: null,
          appearances: [],
        },
      ],
    })
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
      speakerVoices: null,
      voiceLines: [
        { lineIndex: 1, speaker: 'SpeakerA', content: 'test voice line' },
      ],
      storyboards: [
        {
          id: 'storyboard-1',
          clip: { content: 'clinic consultation' },
          panels: [
            {
              panelIndex: 0,
              srtSegment: 'test voice line',
              description: 'doctor asks a calm question',
              characters: 'SpeakerA',
            },
          ],
        },
      ],
    })

    resolveModelSelectionOrSingleMock.mockResolvedValue({
      provider: 'comfyui',
      modelId: COMFYUI_MULTI_SPEAKER_MODEL_ID,
      modelKey: `comfyui::${COMFYUI_MULTI_SPEAKER_MODEL_ID}`,
      mediaType: 'audio',
    })

    getProviderConfigMock.mockResolvedValue({
      id: 'comfyui',
      name: 'ComfyUI',
      baseUrl: 'http://127.0.0.1:8878',
    })
    resolveStorageKeyFromMediaValueMock.mockResolvedValue('images/voice/custom/project-1/chenji.wav')
    buildComfyUiLineRenderTextMock.mockResolvedValue({
      renderText: '[青年男声][冷静] test voice line',
      derivedEmotionPrompt: '冷静克制地回答',
    })
    runComfyUiAudioWorkflowMock.mockResolvedValue({
      audioBase64: Buffer.from(audioBytes).toString('base64'),
      mimeType: 'audio/wav',
    })
  })

  it('uses comfyui reference audio binding for workflow uploads', async () => {
    const result = await generateVoiceLine({
      projectId: 'project-1',
      episodeId: 'episode-1',
      lineId: 'line-1',
      userId: 'user-1',
      locale: 'zh',
      audioModel: `comfyui::${COMFYUI_MULTI_SPEAKER_MODEL_ID}`,
    })

    expect(getProviderConfigMock).toHaveBeenCalledWith('user-1', 'comfyui')
    expect(buildComfyUiLineRenderTextMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'project-1',
      workflowKey: COMFYUI_MULTI_SPEAKER_MODEL_ID,
      speakerName: 'SpeakerA',
      lineText: 'test voice line',
    }))
    expect(runComfyUiAudioWorkflowMock).toHaveBeenCalledWith({
      baseUrl: 'http://127.0.0.1:8878',
      workflowKey: COMFYUI_MULTI_SPEAKER_MODEL_ID,
      prompt: '[青年男声][冷静] test voice line',
      referenceAudioUrls: ['signed://images/voice/custom/project-1/chenji.wav'],
    })
    expect(uploadObjectMock).toHaveBeenCalledTimes(1)
    expect(prismaMock.novelPromotionVoiceLine.update).toHaveBeenCalledWith({
      where: { id: 'line-1' },
      data: {
        audioUrl: 'voice/storage/line-1.wav',
        audioDuration: expect.any(Number),
        emotionPrompt: '冷静克制地回答',
      },
    })
    expect(result).toEqual({
      lineId: 'line-1',
      audioUrl: 'signed://voice/storage/line-1.wav',
      storageKey: 'voice/storage/line-1.wav',
      audioDuration: expect.any(Number),
    })
  })

  it('converts relative signed reference audio urls into fetchable urls for comfyui uploads', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      characters: [
        {
          name: 'SpeakerA',
          customVoiceUrl: '/api/storage/sign?key=images%2Fvoice%2Fcustom%2Fproject-1%2Fchenji.wav&expires=3600',
          voiceId: 'comfyui:c7738c90f45e2de0e4026de2',
          voiceType: 'designed',
          aliases: null,
          introduction: null,
          profileData: null,
          appearances: [],
        },
      ],
    })
    resolveStorageKeyFromMediaValueMock.mockResolvedValueOnce(null)
    extractStorageKeyMock.mockReturnValueOnce(null)
    toFetchableUrlMock.mockImplementation((url: string) => (
      url.startsWith('/') ? `http://internal.local${url}` : url
    ))

    await generateVoiceLine({
      projectId: 'project-1',
      episodeId: 'episode-1',
      lineId: 'line-1',
      userId: 'user-1',
      locale: 'zh',
      audioModel: `comfyui::${COMFYUI_MULTI_SPEAKER_MODEL_ID}`,
    })

    expect(runComfyUiAudioWorkflowMock).toHaveBeenCalledWith({
      baseUrl: 'http://127.0.0.1:8878',
      workflowKey: COMFYUI_MULTI_SPEAKER_MODEL_ID,
      prompt: '[青年男声][冷静] test voice line',
      referenceAudioUrls: ['http://internal.local/api/storage/sign?key=images%2Fvoice%2Fcustom%2Fproject-1%2Fchenji.wav&expires=3600'],
    })
    expect(getSignedUrlMock).not.toHaveBeenCalledWith('images/voice/custom/project-1/chenji.wav', 3600)
  })
})
