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
  mockCompleteTimeline,
  mockReadyProject,
  prismaMock,
  storageMock,
  vi,
  writeFileSync,
} from './bgm-score-worker.fixture'

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

  it('fails explicitly without writing target terminal state for a short generated cue', async () => {
    mockReadyProject()
    mockCompleteTimeline()
    executeAiTextStepMock.mockResolvedValue({ text: buildValidPlanText() })
    generateMusicMock.mockResolvedValue({
      success: true,
      audioBase64: Buffer.from('short-bgm').toString('base64'),
      audioMimeType: 'audio/mpeg',
    })
    execFileMock.mockImplementation((
      _command: string,
      _args: readonly string[],
      optionsOrCallback: unknown,
      maybeCallback?: unknown,
    ) => {
      const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
      if (typeof callback !== 'function') throw new Error('execFile callback missing')
      callback(null, { stdout: '2.000\n', stderr: '' })
    })

    const { handleBgmScoreGenerateTask } = await import('@/lib/bgm-score/generate')
    await expect(handleBgmScoreGenerateTask(buildJob({
      episodeId: 'episode-1',
      musicModel: 'google::lyria-3-pro-preview',
    }))).rejects.toThrow('BGM_SCORE_CUE_AUDIO_DURATION_SHORT:cue-001:2.000:3.000')

    expect(storageMock.uploadObject).not.toHaveBeenCalled()
    const failedCall = prismaMock.projectEditMusicScore.upsert.mock.calls.find((call) => {
      const arg = call[0] as { update?: { status?: string; diagnosticsJson?: { errorMessage?: string } } }
      return arg.update?.status === 'failed'
        && arg.update.diagnosticsJson?.errorMessage === 'BGM_SCORE_CUE_AUDIO_DURATION_SHORT:cue-001:2.000:3.000'
    })
    expect(failedCall).toBeUndefined()
  })
})
