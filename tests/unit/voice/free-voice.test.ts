import { beforeEach, describe, expect, it, vi } from 'vitest'

const findVersionMock = vi.hoisted(() => vi.fn())
const updateVersionMock = vi.hoisted(() => vi.fn())
const resolveModelMock = vi.hoisted(() => vi.fn())
const providerConfigMock = vi.hoisted(() => vi.fn())
const runWorkflowMock = vi.hoisted(() => vi.fn())
const uploadObjectMock = vi.hoisted(() => vi.fn())
const ensureMediaMock = vi.hoisted(() => vi.fn())
const resolveStorageKeyMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    novelPromotionFreeVoiceVersion: {
      findUnique: findVersionMock,
      update: updateVersionMock,
    },
  },
}))
vi.mock('@/lib/api-config', () => ({
  resolveModelSelectionOrSingle: resolveModelMock,
  getProviderKey: (value: string) => value,
  getProviderConfig: providerConfigMock,
}))
vi.mock('@/lib/providers/comfyui/client', () => ({ runComfyUiAudioWorkflow: runWorkflowMock }))
vi.mock('@/lib/storage', () => ({
  uploadObject: uploadObjectMock,
  getSignedUrl: (key: string) => `signed:${key}`,
  toFetchableUrl: (value: string) => value,
  extractStorageKey: (value: string) => value,
}))
vi.mock('@/lib/media/service', () => ({
  ensureMediaObjectFromStorageKey: ensureMediaMock,
  resolveStorageKeyFromMediaValue: resolveStorageKeyMock,
}))

import { resolveComfyUiSingleVoiceWorkflowKey } from '@/lib/voice/comfyui-voice-workflow'
import { generateFreeVoiceVersion } from '@/lib/voice/free-voice'

describe('free voice ComfyUI generation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findVersionMock.mockResolvedValue({
      id: 'version-1',
      recordId: 'record-1',
      audioModel: 'comfyui::baseaudio/多人/LongCat-two',
      record: {
        id: 'record-1',
        text: '需要朗读的文字',
        referenceAudioUrl: '/m/reference',
        novelPromotionProject: { projectId: 'project-1' },
      },
    })
    resolveModelMock.mockResolvedValue({
      provider: 'comfyui',
      modelKey: 'comfyui::baseaudio/多人/LongCat-two',
      modelId: 'baseaudio/多人/LongCat-two',
    })
    providerConfigMock.mockResolvedValue({ baseUrl: 'http://comfy.local' })
    resolveStorageKeyMock.mockResolvedValue('voice/reference.wav')
    runWorkflowMock.mockResolvedValue({
      audioBase64: Buffer.from('generated-audio').toString('base64'),
      mimeType: 'audio/wav',
    })
    uploadObjectMock.mockResolvedValue('voice/free/project-1/record-1/version-1.wav')
    ensureMediaMock.mockResolvedValue({ id: 'media-1', url: '/m/generated', durationMs: 900 })
    updateVersionMock.mockResolvedValue({ id: 'version-1' })
  })

  it('maps multi-speaker workflows to a single-speaker workflow', () => {
    expect(resolveComfyUiSingleVoiceWorkflowKey('baseaudio/多人/LongCat-two'))
      .toBe('baseaudio/单人/LongCat-one')
  })

  it('uses the immutable text and exactly one reference audio', async () => {
    const result = await generateFreeVoiceVersion({
      projectId: 'project-1',
      versionId: 'version-1',
      userId: 'user-1',
      locale: 'zh',
    })

    expect(runWorkflowMock).toHaveBeenCalledWith({
      baseUrl: 'http://comfy.local',
      workflowKey: 'baseaudio/单人/LongCat-one',
      prompt: '需要朗读的文字',
      referenceAudioUrls: ['signed:voice/reference.wav'],
    })
    expect(uploadObjectMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      'voice/free/project-1/record-1/version-1.wav',
      undefined,
      'audio/wav',
    )
    expect(updateVersionMock).toHaveBeenCalledWith({
      where: { id: 'version-1' },
      data: {
        audioModel: 'comfyui::baseaudio/多人/LongCat-two',
        audioUrl: '/m/generated',
        audioMediaId: 'media-1',
        audioDuration: 900,
      },
    })
    expect(result).toEqual({ versionId: 'version-1', audioUrl: '/m/generated' })
  })

  it('fails before calling ComfyUI when the target no longer exists', async () => {
    findVersionMock.mockResolvedValue(null)
    await expect(generateFreeVoiceVersion({
      projectId: 'project-1', versionId: 'missing', userId: 'user-1', locale: 'zh',
    })).rejects.toThrow('FREE_VOICE_VERSION_NOT_FOUND')
    expect(runWorkflowMock).not.toHaveBeenCalled()
  })
})
