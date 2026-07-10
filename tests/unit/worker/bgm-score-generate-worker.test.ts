import {
  beforeEach,
  buildJob,
  configServiceMock,
  describe,
  execFileMock,
  executeAiTextStepMock,
  expect,
  generateMusicMock,
  it,
  mediaServiceMock,
  mockCompleteTimeline,
  mockReadyProject,
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

  it('fails explicitly when shared project model config has no analysis model', async () => {
    mockReadyProject()
    configServiceMock.getProjectModelConfig.mockResolvedValue({ analysisModel: null })
    mockCompleteTimeline()

    const { handleBgmScoreGenerateTask } = await import('@/lib/bgm-score/generate')
    await expect(handleBgmScoreGenerateTask(buildJob({
      episodeId: 'episode-1',
      musicModel: 'google::lyria-3-pro-preview',
    }))).rejects.toThrow('BGM_SCORE_ANALYSIS_MODEL_REQUIRED')

    expect(executeAiTextStepMock).not.toHaveBeenCalled()
    expect(generateMusicMock).not.toHaveBeenCalled()
  })
})
