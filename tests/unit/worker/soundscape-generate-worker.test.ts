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
  loadEpisodeChapterOutputClipsMock,
  prismaMock,
  renderSoundscapeMixMock,
  storageMock,
  submitTaskMock,
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

  it('refuses to generate paid sound effects when the operation is unapproved or mistargeted', async () => {
    const { handleSoundscapeGenerateTask } = await import('@/lib/soundscape/generate')

    const unconfirmedJob = buildJob(TASK_TYPE.SOUNDSCAPE_GENERATE, approvedGeneratePayload)
    unconfirmedJob.data.operationConfirmed = false
    await expect(handleSoundscapeGenerateTask(unconfirmedJob)).rejects.toThrow(
      'SOUNDSCAPE_BILLABLE_MEDIA_APPROVAL_REQUIRED',
    )

    const mistargetedJob = buildJob(TASK_TYPE.SOUNDSCAPE_GENERATE, approvedGeneratePayload)
    mistargetedJob.data.operationId = 'plan_episode_soundscape'
    await expect(handleSoundscapeGenerateTask(mistargetedJob)).rejects.toThrow(
      'SOUNDSCAPE_BILLABLE_MEDIA_APPROVAL_REQUIRED',
    )

    expect(generateSoundEffectMock.mock.calls).toEqual([])
    expect(prismaMock.projectEditSoundscape.upsert.mock.calls).toEqual([])
  })

  it('refuses to generate when the submitted plan does not match the approved exact plan', async () => {
    const { handleSoundscapeGenerateTask } = await import('@/lib/soundscape/generate')

    await expect(handleSoundscapeGenerateTask(buildJob(TASK_TYPE.SOUNDSCAPE_GENERATE, {
      ...approvedGeneratePayload,
      timelineSignature: undefined,
    }))).rejects.toThrow('SOUNDSCAPE_GENERATE_TIMELINE_SIGNATURE_REQUIRED')

    await expect(handleSoundscapeGenerateTask(buildJob(TASK_TYPE.SOUNDSCAPE_GENERATE, {
      ...approvedGeneratePayload,
      soundscapePlanHash: undefined,
    }))).rejects.toThrow('SOUNDSCAPE_GENERATE_PLAN_HASH_REQUIRED')

    await expect(handleSoundscapeGenerateTask(buildJob(TASK_TYPE.SOUNDSCAPE_GENERATE, {
      ...approvedGeneratePayload,
      soundscapePlanHash: 'stale-approved-hash',
    }))).rejects.toThrow('SOUNDSCAPE_APPROVED_PLAN_HASH_INVALID')

    expect(generateSoundEffectMock.mock.calls).toEqual([])
  })
})
