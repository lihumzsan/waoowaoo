import {
  TASK_TYPE,
  beforeEach,
  buildJob,
  clips,
  describe,
  ensureMediaObjectFromStorageKeyMock,
  execFileMock,
  executeAiStructuredTextStepMock,
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

  it('completes a none_needed soundscape plan without submitting a generate task', async () => {
    const { handleSoundscapePlanTask } = await import('@/lib/soundscape/generate')
    const noneNeededPlan = {
      schemaVersion: 1,
      decision: 'none_needed',
      sources: [],
      sections: [],
    }
    executeAiStructuredTextStepMock.mockResolvedValue({ data: noneNeededPlan })

    const result = await handleSoundscapePlanTask(buildJob(TASK_TYPE.SOUNDSCAPE_PLAN, {
      episodeId: 'episode-1',
      soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
    }))

    expect(result).toEqual({
      episodeId: 'episode-1',
      soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
      decision: 'none_needed',
      sourceCount: 0,
      sectionCount: 0,
    })
    expect(submitTaskMock).not.toHaveBeenCalled()
    expect(latestSoundscapeUpsertUpdate()).toMatchObject({
      status: 'completed',
      timelineSignature,
      soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
      sourcesJson: [],
      mixJson: expect.anything(),
    })
  })

  it('persists a planned soundscape without auto-submitting any paid generate task', async () => {
    const { handleSoundscapePlanTask } = await import('@/lib/soundscape/generate')
    executeAiStructuredTextStepMock.mockResolvedValue({ data: soundscapePlan })

    const result = await handleSoundscapePlanTask(buildJob(TASK_TYPE.SOUNDSCAPE_PLAN, {
      episodeId: 'episode-1',
      soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
    }))

    expect(result).toEqual({
      episodeId: 'episode-1',
      soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
      decision: 'soundscape',
      sourceCount: 1,
      sectionCount: 1,
    })
    expect(submitTaskMock.mock.calls).toEqual([])
    expect(generateSoundEffectMock.mock.calls).toEqual([])
    expect(latestSoundscapeUpsertUpdate()).toMatchObject({
      status: 'planned',
      timelineSignature,
      soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
      planJson: soundscapePlan,
    })
  })
})
