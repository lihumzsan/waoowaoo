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

  it('reuses an existing loop when the environment fingerprint and model match even if the prompt changed', async () => {
    const { handleSoundscapeGenerateTask } = await import('@/lib/soundscape/generate')
    const existingSource = {
      sourceId: 'previous_city_wind',
      environmentFingerprint: 'night_city_wind',
      prompt: 'Older seamless city wind loop prompt, no music, no voices, no footsteps.',
      mediaId: 'media-existing-source',
      url: '/m/existing-source',
      storageKey: 'soundscape/source/existing.mp3',
      mimeType: 'audio/mpeg',
      durationMs: 30000,
      loopDurationSeconds: 22,
      promptInfluence: 0.35,
      soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
    }
    prismaMock.projectEditSoundscape.findUnique.mockResolvedValue({
      planJson: soundscapePlan,
      sourcesJson: [existingSource],
      timelineSignature,
    })
    storageMock.uploadObject.mockReset()
    storageMock.uploadObject.mockResolvedValueOnce('soundscape/mix/asset.m4a')
    ensureMediaObjectFromStorageKeyMock.mockReset()
    ensureMediaObjectFromStorageKeyMock.mockResolvedValueOnce({
      id: 'media-mix-1',
      url: '/m/soundscape-mix',
    })

    const result = await handleSoundscapeGenerateTask(
      buildJob(TASK_TYPE.SOUNDSCAPE_GENERATE, approvedGeneratePayload),
    )

    expect(generateSoundEffectMock.mock.calls).toEqual([])
    expect(storageMock.getObjectBuffer).toHaveBeenCalledWith('soundscape/source/existing.mp3')
    expect(ensureMediaObjectFromStorageKeyMock).toHaveBeenCalledTimes(1)
    expect(ensureMediaObjectFromStorageKeyMock).toHaveBeenCalledWith('soundscape/mix/asset.m4a', {
      mimeType: 'audio/mp4',
      sizeBytes: Buffer.from('mix-audio').byteLength,
      durationMs: 30000,
    })
    expect(result).toMatchObject({
      episodeId: 'episode-1',
      sourceCount: 1,
      sectionCount: 1,
      storageKey: 'soundscape/mix/asset.m4a',
    })
    expect(latestSoundscapeUpsertUpdate()).toMatchObject({
      status: 'completed',
      sourcesJson: [expect.objectContaining({
        sourceId: 'city_wind',
        environmentFingerprint: 'night_city_wind',
        mediaId: 'media-existing-source',
        storageKey: 'soundscape/source/existing.mp3',
        prompt: existingSource.prompt,
      })],
    })
  })
})
