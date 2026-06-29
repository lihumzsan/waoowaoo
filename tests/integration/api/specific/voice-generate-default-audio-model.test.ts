import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const audioModels = vi.hoisted(() => ({
  user: 'comfyui::baseaudio/单人/s2-one',
  project: 'comfyui::baseaudio/单人/LongCat-one',
  request: 'comfyui::baseaudio/多人/s2-two',
}))

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
    project: { id: 'project-1', userId: 'user-1' },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    findUnique: vi.fn(async () => ({ audioModel: audioModels.user })),
  },
  novelPromotionProject: {
    findUnique: vi.fn<() => Promise<{
      id: string
      audioModel: string | null
      characters: Array<{ name: string; customVoiceUrl: string; voiceId: string | null }>
    } | null>>(async () => ({
      id: 'np-1',
      audioModel: audioModels.project,
      characters: [
        { name: 'Narrator', customVoiceUrl: 'https://voice.example/narrator.wav', voiceId: null },
      ],
    })),
  },
  novelPromotionEpisode: {
    findFirst: vi.fn(async () => ({
      id: 'episode-1',
      speakerVoices: '{}',
    })),
  },
  novelPromotionVoiceLine: {
    findFirst: vi.fn(async () => ({
      id: 'line-1',
      speaker: 'Narrator',
      content: 'hello world',
    })),
    findMany: vi.fn(async () => []),
  },
}))

const submitTaskMock = vi.hoisted(() => vi.fn<typeof import('@/lib/task/submitter').submitTask>(async () => ({
  success: true,
  async: true,
  taskId: 'task-1',
  runId: null,
  status: 'queued',
  deduped: false,
})))

const apiConfigMock = vi.hoisted(() => ({
  resolveModelSelectionOrSingle: vi.fn(async (_userId: string, model: string | null | undefined) => {
    const modelKey = model || audioModels.user
    const delimiterIndex = modelKey.indexOf('::')
    const provider = delimiterIndex >= 0 ? modelKey.slice(0, delimiterIndex) : 'comfyui'
    const modelId = delimiterIndex >= 0 ? modelKey.slice(delimiterIndex + 2) : modelKey
    return {
      provider,
      modelId,
      modelKey,
      mediaType: 'audio',
    }
  }),
  getProviderKey: vi.fn((providerId: string) => providerId.split(':')[0]),
}))

const hasVoiceLineAudioOutputMock = vi.hoisted(() => vi.fn(async () => false))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: vi.fn(() => 'zh'),
}))
vi.mock('@/lib/task/has-output', () => ({
  hasVoiceLineAudioOutput: hasVoiceLineAudioOutputMock,
}))

describe('api specific - voice generate default audio model', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hasVoiceLineAudioOutputMock.mockResolvedValue(false)
  })

  it('uses project audioModel when request does not provide one', async () => {
    const mod = await import('@/app/api/novel-promotion/[projectId]/voice-generate/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/voice-generate',
      method: 'POST',
      body: {
        episodeId: 'episode-1',
        lineId: 'line-1',
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(res.status).toBe(200)
    expect(apiConfigMock.resolveModelSelectionOrSingle).toHaveBeenCalledWith(
      'user-1',
      audioModels.project,
      'audio',
    )

    const submitCall = submitTaskMock.mock.calls[0] as [{ payload?: Record<string, unknown> }] | undefined
    const submitArg = submitCall?.[0]
    expect(submitArg?.payload?.audioModel).toBe(audioModels.project)
  })

  it('request audioModel overrides user preference audioModel', async () => {
    const mod = await import('@/app/api/novel-promotion/[projectId]/voice-generate/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/voice-generate',
      method: 'POST',
      body: {
        episodeId: 'episode-1',
        lineId: 'line-1',
        audioModel: audioModels.request,
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(res.status).toBe(200)
    expect(apiConfigMock.resolveModelSelectionOrSingle).toHaveBeenCalledWith(
      'user-1',
      audioModels.request,
      'audio',
    )
  })

  it('falls back to user preference audioModel when project audioModel is empty', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-1',
      audioModel: null,
      characters: [
        { name: 'Narrator', customVoiceUrl: 'https://voice.example/narrator.wav', voiceId: null },
      ],
    })

    const mod = await import('@/app/api/novel-promotion/[projectId]/voice-generate/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/voice-generate',
      method: 'POST',
      body: {
        episodeId: 'episode-1',
        lineId: 'line-1',
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(res.status).toBe(200)
    expect(apiConfigMock.resolveModelSelectionOrSingle).toHaveBeenCalledWith(
      'user-1',
      audioModels.user,
      'audio',
    )
  })

  it('marks single-line task payload as regenerate when the voice line already has audio', async () => {
    hasVoiceLineAudioOutputMock.mockResolvedValueOnce(true)

    const mod = await import('@/app/api/novel-promotion/[projectId]/voice-generate/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/voice-generate',
      method: 'POST',
      body: {
        episodeId: 'episode-1',
        lineId: 'line-1',
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(res.status).toBe(200)
    const submitCall = submitTaskMock.mock.calls[0] as [{ payload?: Record<string, unknown> }] | undefined
    const submitArg = submitCall?.[0]
    expect(submitArg?.payload?.ui).toMatchObject({
      intent: 'regenerate',
      hasOutputAtStart: true,
    })
  })
})
