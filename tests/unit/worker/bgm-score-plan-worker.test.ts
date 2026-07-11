import {
  beforeEach,
  buildJob,
  buildValidPlanText,
  describe,
  execFileMock,
  executeAiTextStepMock,
  expect,
  generateMusicMock,
  it,
  mediaServiceMock,
  mockReadyProject,
  prismaMock,
  storageMock,
  streamMock,
  vi,
  writeFileSync,
} from './bgm-score-worker.fixture'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'

describe('bgm score worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    execFileMock.mockImplementation((
      command: string,
      args: readonly string[],
      optionsOrCallback: unknown,
      maybeCallback?: unknown,
    ) => {
      const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
      if (typeof callback !== 'function') throw new Error('execFile callback missing')
      if (command === 'ffmpeg') {
        const outputPath = args[args.length - 1]
        if (typeof outputPath === 'string') {
          writeFileSync(outputPath, Buffer.from('mixed-bgm'))
        }
      }
      callback(null, { stdout: '3.500\n', stderr: '' })
    })
    storageMock.uploadObject.mockImplementation(async (_buffer: Buffer, key: string) => key)
    mediaServiceMock.ensureMediaObjectFromStorageKey.mockImplementation(async (storageKey: string) => ({
      id: storageKey.includes('music/bgm-score') ? 'media-mix' : `media-${storageKey}`,
      url: storageKey.includes('music/bgm-score') ? '/m/bgm-mix' : `/m/${storageKey}`,
    }))
  })

  it('generates BGM from the rendered chapter timeline', async () => {
    mockReadyProject()
    executeAiTextStepMock.mockResolvedValue({ text: buildValidPlanText() })
    generateMusicMock.mockResolvedValue({
      success: true,
      audioBase64: Buffer.from('draft-bgm').toString('base64'),
      audioMimeType: 'audio/mpeg',
    })

    const { handleBgmScoreGenerateTask } = await import('@/lib/bgm-score/generate')
    const result = await handleBgmScoreGenerateTask(buildJob({
      episodeId: 'episode-1',
      musicModel: 'google::lyria-3-pro-preview',
    }))

    const storageKey = buildTaskArtifactStorageKey({
      taskId: 'task-bgm-1',
      artifact: 'bgm-score:mix',
      extension: 'm4a',
    })
    expect(result).toMatchObject({
      episodeId: 'episode-1',
      mediaId: `media-${storageKey}`,
      audioUrl: `/m/${storageKey}`,
      durationMs: 3500,
    })
    expect(executeAiTextStepMock).toHaveBeenCalledTimes(1)
    const planPrompt = String(executeAiTextStepMock.mock.calls[0]?.[0]?.messages?.[0]?.content)
    expect(planPrompt).toContain('"sourceKind": "panel"')
    expect(planPrompt).toContain('A single rendered test chapter.')
    expect(planPrompt).toContain('所有会显示在画布上的字段值必须使用中文自然语言')
    expect(generateMusicMock).toHaveBeenCalledTimes(1)
    expect(streamMock.flush).toHaveBeenCalled()
  })

  it('replays a completed score without invoking the model or music provider again', async () => {
    prismaMock.projectEditMusicScore.findFirst.mockResolvedValueOnce({
      status: 'completed',
      musicModel: 'google::lyria-3-pro-preview',
      mixJson: {
        mediaId: 'media-mix',
        url: '/m/bgm-mix',
        storageKey: 'music/bgm-score/mix.m4a',
        mimeType: 'audio/mp4',
        durationMs: 3500,
      },
    })

    const { handleBgmScoreGenerateTask } = await import('@/lib/bgm-score/generate')
    const result = await handleBgmScoreGenerateTask(buildJob({
      episodeId: 'episode-1',
      musicModel: 'google::lyria-3-pro-preview',
    }))

    expect(result).toMatchObject({ mediaId: 'media-mix', durationMs: 3500 })
    expect(executeAiTextStepMock).not.toHaveBeenCalled()
    expect(generateMusicMock).not.toHaveBeenCalled()
  })
})
