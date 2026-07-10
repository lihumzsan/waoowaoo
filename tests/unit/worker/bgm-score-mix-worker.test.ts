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

  it('fails the task and does not upload a mix when final music generation fails', async () => {
    mockReadyProject()
    mockCompleteTimeline()
    executeAiTextStepMock.mockResolvedValue({ text: buildValidPlanText() })
    generateMusicMock.mockResolvedValue({
      success: false,
      error: 'provider rejected final BGM',
    })

    const { handleBgmScoreGenerateTask } = await import('@/lib/bgm-score/generate')
    await expect(handleBgmScoreGenerateTask(buildJob({
      episodeId: 'episode-1',
      musicModel: 'google::lyria-3-pro-preview',
    }))).rejects.toThrow('provider rejected final BGM')

    expect(storageMock.uploadObject).not.toHaveBeenCalled()
    const failedCall = prismaMock.projectEditMusicScore.upsert.mock.calls.find((call) => {
      const arg = call[0] as { update?: { status?: string; diagnosticsJson?: { errorMessage?: string } } }
      return arg.update?.status === 'failed'
        && arg.update.diagnosticsJson?.errorMessage === 'provider rejected final BGM'
    })
    expect(failedCall).toBeTruthy()
  })
})
