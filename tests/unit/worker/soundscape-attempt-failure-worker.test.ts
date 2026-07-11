import {
  TASK_TYPE,
  approvedGeneratePayload,
  beforeEach,
  buildJob,
  clips,
  describe,
  ensureMediaObjectFromStorageKeyMock,
  execFileMock,
  expect,
  generateSoundEffectMock,
  getProjectModelConfigMock,
  it,
  latestSoundscapeUpsertUpdate,
  loadEpisodeChapterOutputClipsMock,
  prismaMock,
  renderSoundscapeMixMock,
  soundscapePlan,
  storageMock,
  submitTaskMock,
  timelineSignature,
  vi,
  writeFile,
} from './soundscape-worker.fixture'

describe('soundscape worker', () => {
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
      if (command === 'ffprobe' && args.includes('format=duration')) {
        callback(null, { stdout: '30.000\n', stderr: '' })
        return
      }
      callback(null, { stdout: '', stderr: '' })
    })
    prismaMock.project.findUnique.mockResolvedValue({ videoRatio: '16:9' })
    prismaMock.projectEpisode.findFirst.mockResolvedValue({ id: 'episode-1' })
    prismaMock.projectEditSoundscape.findUnique.mockResolvedValue(null)
    getProjectModelConfigMock.mockResolvedValue({ analysisModel: 'llm::analysis' })
    loadEpisodeChapterOutputClipsMock.mockResolvedValue(clips)
    submitTaskMock.mockResolvedValue({ taskId: 'task-soundscape-generate' })
    storageMock.uploadObject
      .mockResolvedValueOnce('soundscape/source/asset.mp3')
      .mockResolvedValueOnce('soundscape/mix/asset.m4a')
    storageMock.getObjectBuffer.mockResolvedValue(Buffer.from('source-audio'))
    ensureMediaObjectFromStorageKeyMock
      .mockResolvedValueOnce({ id: 'media-source-1', url: '/m/source-1' })
      .mockResolvedValueOnce({ id: 'media-mix-1', url: '/m/soundscape-mix' })
    renderSoundscapeMixMock.mockImplementation(async (input: { readonly outputPath: string }) => {
      await writeFile(input.outputPath, Buffer.from('mix-audio'))
    })
    generateSoundEffectMock.mockResolvedValue({
      success: true,
      audioBase64: Buffer.from('source-audio').toString('base64'),
      audioMimeType: 'audio/mpeg',
    })
  })

  it('generates loop sources, stores media records, renders a mix, and persists sourcesJson and mixJson', async () => {
    const { handleSoundscapeGenerateTask } = await import('@/lib/soundscape/generate')
    prismaMock.projectEditSoundscape.findUnique.mockResolvedValue({
      planJson: soundscapePlan,
      sourcesJson: [],
      timelineSignature,
    })

    const result = await handleSoundscapeGenerateTask(
      buildJob(TASK_TYPE.SOUNDSCAPE_GENERATE, approvedGeneratePayload),
    )

    expect(generateSoundEffectMock).toHaveBeenCalledWith(
      'user-1',
      'elevenlabs::eleven_text_to_sound_v2',
      soundscapePlan.sources[0].prompt,
      {
        durationSeconds: 30,
        loop: true,
        promptInfluence: 0.55,
        outputFormat: 'mp3_44100_128',
      },
      { key: 'media:sound-effect:source:city_wind' },
    )
    expect(ensureMediaObjectFromStorageKeyMock).toHaveBeenNthCalledWith(1, 'soundscape/source/asset.mp3', {
      mimeType: 'audio/mpeg',
      sizeBytes: Buffer.from('source-audio').byteLength,
      durationMs: 30000,
    })
    expect(ensureMediaObjectFromStorageKeyMock).toHaveBeenNthCalledWith(2, 'soundscape/mix/asset.m4a', {
      mimeType: 'audio/mp4',
      sizeBytes: Buffer.from('mix-audio').byteLength,
      durationMs: 30000,
    })
    expect(result).toMatchObject({
      episodeId: 'episode-1',
      mediaId: 'media-mix-1',
      audioUrl: '/m/soundscape-mix',
      storageKey: 'soundscape/mix/asset.m4a',
      soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
      sourceCount: 1,
      sectionCount: 1,
      durationMs: 30000,
    })
    expect(latestSoundscapeUpsertUpdate()).toMatchObject({
      status: 'completed',
      timelineSignature,
      planJson: soundscapePlan,
      mixJson: {
        mediaId: 'media-mix-1',
        url: '/m/soundscape-mix',
        storageKey: 'soundscape/mix/asset.m4a',
        mimeType: 'audio/mp4',
        durationMs: 30000,
      },
      sourcesJson: [expect.objectContaining({
        sourceId: 'city_wind',
        mediaId: 'media-source-1',
        storageKey: 'soundscape/source/asset.mp3',
        soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
      })],
    })
  })
})
