import {
  afterEach,
  beforeEach,
  buildCorePlan,
  buildDefaultChapterTimelineSignature,
  buildJob,
  describe,
  execFileMock,
  executeAiTextStepMock,
  expect,
  generateMusicMock,
  it,
  mediaServiceMock,
  prismaMock,
  readFileMock,
  storageMock,
  vi,
} from './final-video-render-worker.fixture'

describe('final video render worker', () => {
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
      const argsText = args.join(' ')
      if (command === 'ffprobe' && argsText.includes('duration')) {
        callback(null, { stdout: '3.000\n', stderr: '' })
        return
      }
      if (command === 'ffprobe' && argsText.includes('-select_streams a:0')) {
        callback(null, { stdout: '0\n', stderr: '' })
        return
      }
      if (command === 'ffmpeg' && argsText.includes('print_format=json')) {
        callback(null, { stdout: '', stderr: [
          '{',
          '  "input_i": "-18.20",',
          '  "input_tp": "-2.30",',
          '  "input_lra": "5.20",',
          '  "input_thresh": "-28.30",',
          '  "target_offset": "0.30"',
          '}',
        ].join('\n') })
        return
      }
      callback(null, { stdout: '', stderr: '' })
    })
    readFileMock.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('final.mp4')) return Buffer.from('final-video')
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      return actual.readFile(filePath)
    })
    storageMock.getObjectBuffer.mockResolvedValue(Buffer.from('source-video'))
    storageMock.uploadObject.mockResolvedValue('final-video/asset.mp4')
    mediaServiceMock.resolveStorageKeyFromMediaValue.mockResolvedValue('video/source.mp4')
    mediaServiceMock.ensureMediaObjectFromStorageKey.mockResolvedValue({
      id: 'media-final',
      url: '/m/final-video',
    })
    executeAiTextStepMock.mockResolvedValue({ text: 'cinematic bgm prompt' })
    generateMusicMock.mockResolvedValue({
      success: true,
      audioBase64: Buffer.from('music').toString('base64'),
      audioMimeType: 'audio/mpeg',
      metadata: { provider: 'test' },
    })
    prismaMock.project.findUnique.mockResolvedValue({ videoRatio: '9:16', analysisModel: 'openai::gpt-4.1' })
    prismaMock.projectEpisode.findFirst.mockResolvedValue({ id: 'episode-1' })
    prismaMock.projectEditChapter.findUnique.mockResolvedValue({ id: 'chapter-1' })
    prismaMock.projectEditChapter.findMany.mockResolvedValue([
      {
        id: 'chapter-1',
        chapterIndex: 0,
        title: 'Chapter 1',
        summary: 'A rendered test chapter.',
        targetDurationSec: 3,
        renderStatus: 'completed',
        outputMedia: {
          storageKey: 'chapter-video/chapter-1.mp4',
          durationMs: 3000,
        },
        editScript: {
          corePlanJson: buildCorePlan(),
        },
      },
    ])
    prismaMock.projectEditChapter.create.mockResolvedValue({ id: 'chapter-1' })
    prismaMock.projectEditScript.findUnique.mockResolvedValue({
      id: 'edit-script-1',
      durationSec: 3,
      chapter: {
        title: 'Chapter 1',
        summary: 'A single test chapter.',
      },
      editBible: {
        userPrompt: 'Render a final test edit.',
        styleBibleJson: null,
      },
      corePlanJson: buildCorePlan(),
    })
    prismaMock.projectEditBible.findUnique.mockResolvedValue({
      styleBibleJson: null,
    })
    prismaMock.projectPanel.findMany.mockResolvedValue([
      {
        id: 'panel-1',
        panelIndex: 0,
        panelNumber: 1,
        duration: 3,
        description: 'panel 1',
        videoUrl: null,
        videoMedia: null,
        sourceShotId: 'shot-1',
        sourceGenerationSegmentId: 'edit-script-1:generationSegment:1',
        storyboard: {
          id: 'storyboard-1',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          storyboardTextJson: JSON.stringify({ editScriptId: 'edit-script-1' }),
          clip: { createdAt: new Date('2026-01-01T00:00:00.000Z') },
        },
      },
    ])
    prismaMock.projectVideoGroup.findMany.mockResolvedValue([])
    prismaMock.projectEditMusicScore.findUnique.mockResolvedValue({
      status: 'completed',
      timelineSignature: buildDefaultChapterTimelineSignature(),
      mixJson: {
        mediaId: 'media-bgm',
        url: '/m/bgm',
        storageKey: 'music/bgm-score.m4a',
        mimeType: 'audio/mp4',
        durationMs: 3000,
      },
    })
    prismaMock.projectEditSoundscape.findUnique.mockResolvedValue({
      status: 'completed',
      timelineSignature: buildDefaultChapterTimelineSignature(),
      planJson: {
        schemaVersion: 1,
        decision: 'none_needed',
        sources: [],
        sections: [],
      },
      mixJson: null,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('mixes preserved source audio with normalized ducked BGM for final renders', async () => {
    prismaMock.projectPanel.findMany.mockResolvedValue([
      {
        id: 'panel-1',
        panelIndex: 0,
        panelNumber: 1,
        duration: 3,
        description: 'panel 1',
        videoUrl: null,
        videoMedia: {
          storageKey: 'video/source.mp4',
          url: '/m/source-video',
        },
        sourceShotId: 'shot-1',
        sourceGenerationSegmentId: 'edit-script-1:generationSegment:1',
        storyboard: {
          id: 'storyboard-1',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          storyboardTextJson: JSON.stringify({ editScriptId: 'edit-script-1' }),
          clip: { createdAt: new Date('2026-01-01T00:00:00.000Z') },
        },
      },
    ])
    const { handleFinalVideoRenderTask } = await import('@/lib/workers/final-video-render')

    const result = await handleFinalVideoRenderTask(buildJob({
      episodeId: 'episode-1',
    }))

    expect(result).toMatchObject({
      videoMediaId: 'media-final',
      outputUrl: '/m/final-video',
      storageKey: 'final-video/asset.mp4',
    })
    const ffmpegCalls = execFileMock.mock.calls
      .filter((call) => call[0] === 'ffmpeg')
      .map((call) => (call[1] as readonly string[]).join(' '))
    expect(ffmpegCalls.some((args) => args.includes('aformat=sample_fmts=fltp:channel_layouts=stereo'))).toBe(true)
    expect(ffmpegCalls.some((args) => args.includes('concat=n=1:v=0:a=1'))).toBe(true)
    expect(ffmpegCalls.some((args) => args.includes('loudnorm=I=-16.000'))).toBe(true)
    expect(ffmpegCalls.some((args) => args.includes('loudnorm=I=-6.000'))).toBe(true)
    expect(ffmpegCalls.some((args) => args.includes('loudnorm=I=-24.000'))).toBe(false)
    expect(ffmpegCalls.some((args) => args.includes('volume=1.000'))).toBe(true)
    expect(ffmpegCalls.some((args) => args.includes('sidechaincompress='))).toBe(true)
    expect(ffmpegCalls.some((args) => args.includes('amix=inputs=2'))).toBe(true)
    expect(ffmpegCalls.some((args) => args.includes(' -an '))).toBe(true)
    const updateCalls = prismaMock.projectEpisodeFinalOutput.updateMany.mock.calls as unknown as Array<[
      { data?: { renderStatus?: string } },
    ]>
    const completedFinalOutputCall = updateCalls.find((call) => {
      const arg = call[0] as { data?: { renderStatus?: string } }
      return arg.data?.renderStatus === 'completed'
    })
    expect(completedFinalOutputCall).toBeTruthy()
    expect(completedFinalOutputCall?.[0]).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        renderStatus: 'completed',
        outputMediaId: 'media-final',
        outputUrl: '/m/final-video',
      }),
    }))
  })

  it('mixes completed soundscape as a third audio layer without sidechain ducking it', async () => {
    prismaMock.projectEditSoundscape.findUnique.mockResolvedValue({
      status: 'completed',
      timelineSignature: buildDefaultChapterTimelineSignature(),
      planJson: {
        schemaVersion: 1,
        decision: 'soundscape',
        sources: [{
          sourceId: 'city_wind',
          environmentFingerprint: 'night_city_wind',
          prompt: 'Seamless loop of steady city wind, no music, no voices.',
          loopDurationSeconds: 30,
          promptInfluence: 0.55,
        }],
        sections: [{
          sourceId: 'city_wind',
          fromShotId: 'shot-1',
          toShotId: 'shot-1',
          perspective: 'exterior_near',
          intensity: 'medium',
          transitionIn: 'fade',
          transitionOut: 'fade',
        }],
      },
      mixJson: {
        mediaId: 'media-soundscape',
        url: '/m/soundscape',
        storageKey: 'soundscape/mix.m4a',
        mimeType: 'audio/mp4',
        durationMs: 3000,
      },
    })
    const { handleFinalVideoRenderTask } = await import('@/lib/workers/final-video-render')

    await handleFinalVideoRenderTask(buildJob({
      episodeId: 'episode-1',
    }))

    expect(storageMock.getObjectBuffer).toHaveBeenCalledWith('soundscape/mix.m4a')
    const ffmpegCalls = execFileMock.mock.calls
      .filter((call) => call[0] === 'ffmpeg')
      .map((call) => (call[1] as readonly string[]).join(' '))
    expect(ffmpegCalls.some((args) => args.includes('loudnorm=I=-24.000'))).toBe(true)
    expect(ffmpegCalls.some((args) => args.includes('[main_mix][soundscape_norm][ducked_bgm]amix=inputs=3'))).toBe(true)
    expect(ffmpegCalls.some((args) => args.includes('[soundscape_norm]asplit'))).toBe(false)
  })
})
