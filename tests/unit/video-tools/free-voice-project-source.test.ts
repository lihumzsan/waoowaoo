import { beforeEach, describe, expect, it, vi } from 'vitest'

const projectFindFirstMock = vi.hoisted(() => vi.fn())
const characterFindFirstMock = vi.hoisted(() => vi.fn())
const resolveModelSelectionOrSingleMock = vi.hoisted(() => vi.fn())
const getProviderConfigMock = vi.hoisted(() => vi.fn())
const redisGetMock = vi.hoisted(() => vi.fn())
const redisSetMock = vi.hoisted(() => vi.fn())
const addTaskJobMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: { findFirst: projectFindFirstMock },
    novelPromotionCharacter: { findFirst: characterFindFirstMock },
  },
}))

vi.mock('@/lib/api-config', () => ({
  getProviderConfig: getProviderConfigMock,
  getProviderKey: (provider: string) => provider,
  resolveModelSelectionOrSingle: resolveModelSelectionOrSingleMock,
}))

vi.mock('@/lib/redis', () => ({
  redis: { get: redisGetMock, set: redisSetMock },
  queueRedis: {},
}))

vi.mock('@/lib/task/queues', () => ({
  addTaskJob: addTaskJobMock,
}))

import { createVideoToolFreeVoiceTask } from '@/lib/video-tools/free-voice'

describe('video tools free voice project-character source', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    projectFindFirstMock.mockResolvedValue({
      id: 'project-1',
      name: 'Project One',
      novelPromotionData: {
        id: 'novel-1',
        audioModel: 'comfyui::baseaudio/单人/LongCat-one',
      },
    })
    characterFindFirstMock.mockResolvedValue({
      id: 'character-1',
      name: 'Hero',
      customVoiceUrl: '/voice/hero.wav',
    })
    resolveModelSelectionOrSingleMock.mockResolvedValue({
      provider: 'comfyui',
      modelKey: 'comfyui::baseaudio/单人/LongCat-one',
    })
    getProviderConfigMock.mockResolvedValue({ baseUrl: 'http://127.0.0.1:8188' })
    redisGetMock.mockResolvedValue(null)
    redisSetMock.mockResolvedValue('OK')
    addTaskJobMock.mockResolvedValue({ id: 'job-1' })
  })

  it('uses the selected project character reference audio in the transient task', async () => {
    const result = await createVideoToolFreeVoiceTask({
      userId: 'user-1', locale: 'zh', text: 'hello',
      projectId: 'project-1', characterId: 'character-1',
    })

    expect(projectFindFirstMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'project-1', userId: 'user-1' },
    }))
    expect(characterFindFirstMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'character-1', novelPromotionProjectId: 'novel-1' },
    }))
    expect(resolveModelSelectionOrSingleMock).toHaveBeenCalledWith(
      'user-1',
      'comfyui::baseaudio/单人/LongCat-one',
      'audio',
    )
    expect(addTaskJobMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      payload: expect.objectContaining({ referenceAudioUrl: '/voice/hero.wav' }),
    }), expect.any(Object))
    const queuedTask = addTaskJobMock.mock.calls[0]?.[0]
    expect(queuedTask?.taskId).toMatch(/^free_voice-/)
    expect(queuedTask?.taskId).not.toContain(':')
    expect(result.record).toMatchObject({
      projectId: 'project-1', projectName: 'Project One',
      characterId: 'character-1', characterName: 'Hero', voiceName: 'Hero',
    })
  })

  it('rejects an unowned or missing project before queueing', async () => {
    projectFindFirstMock.mockResolvedValueOnce(null)

    await expect(createVideoToolFreeVoiceTask({
      userId: 'user-1', locale: 'zh', text: 'hello',
      projectId: 'project-1', characterId: 'character-1',
    })).rejects.toThrow()

    expect(characterFindFirstMock).not.toHaveBeenCalled()
    expect(addTaskJobMock).not.toHaveBeenCalled()
  })

  it('rejects a character outside the selected project before queueing', async () => {
    characterFindFirstMock.mockResolvedValueOnce(null)

    await expect(createVideoToolFreeVoiceTask({
      userId: 'user-1', locale: 'zh', text: 'hello',
      projectId: 'project-1', characterId: 'character-1',
    })).rejects.toThrow()

    expect(addTaskJobMock).not.toHaveBeenCalled()
  })

  it('rejects a character without reference audio before queueing', async () => {
    characterFindFirstMock.mockResolvedValueOnce({
      id: 'character-1',
      name: 'Hero',
      customVoiceUrl: null,
    })

    await expect(createVideoToolFreeVoiceTask({
      userId: 'user-1', locale: 'zh', text: 'hello',
      projectId: 'project-1', characterId: 'character-1',
    })).rejects.toThrow('FREE_VOICE_REFERENCE_AUDIO_REQUIRED')

    expect(addTaskJobMock).not.toHaveBeenCalled()
  })
})
