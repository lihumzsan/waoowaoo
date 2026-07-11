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
  reportTaskProgressMock,
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

  it('fails explicitly when a chapter has no rendered output', async () => {
    prismaMock.projectEditChapter.findMany.mockResolvedValue([
      {
        id: 'chapter-1',
        chapterIndex: 0,
        title: 'Chapter 1',
        summary: 'A rendered test chapter.',
        targetDurationSec: 3,
        renderStatus: 'completed',
        outputMedia: null,
        editScript: {
          corePlanJson: buildCorePlan(),
        },
      },
    ])
    const { handleFinalVideoRenderTask } = await import('@/lib/workers/final-video-render')

    await expect(handleFinalVideoRenderTask(buildJob({
      episodeId: 'episode-1',
    }))).rejects.toThrow('EPISODE_CHAPTER_OUTPUT_REQUIRED:chapter-1')

    expect(generateMusicMock).not.toHaveBeenCalled()
    expect(prismaMock.projectEpisodeFinalOutput.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { episodeId: 'episode-1' },
      update: expect.objectContaining({ renderStatus: 'processing', renderTaskId: 'task-1' }),
    }))
    expect(prismaMock.projectEpisodeFinalOutput.upsert).toHaveBeenCalledTimes(1)
    expect(reportTaskProgressMock).toHaveBeenCalledWith(expect.anything(), 10, {
      stage: 'final_render_prepare',
    })
  })

  it('uses stored chapter render output as the final render source', async () => {
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
    const { handleFinalVideoRenderTask } = await import('@/lib/workers/final-video-render')

    const result = await handleFinalVideoRenderTask(buildJob({
      episodeId: 'episode-1',
    }))

    expect(result).toMatchObject({
      videoMediaId: 'media-final',
      outputUrl: '/m/final-video',
      storageKey: 'final-video/asset.mp4',
    })
    expect(mediaServiceMock.resolveStorageKeyFromMediaValue).toHaveBeenCalledWith(expect.objectContaining({
      storageKey: 'chapter-video/chapter-1.mp4',
    }))
    expect(prismaMock.projectEpisodeFinalOutput.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { episodeId: 'episode-1' },
      update: expect.objectContaining({
        renderStatus: 'completed',
        renderTaskId: 'task-1',
        outputUrl: '/m/final-video',
        outputMediaId: 'media-final',
      }),
    }))
  })

  it('fails explicitly when no completed BGM mix exists', async () => {
    prismaMock.projectEditMusicScore.findUnique.mockResolvedValue(null)
    const { handleFinalVideoRenderTask } = await import('@/lib/workers/final-video-render')

    await expect(handleFinalVideoRenderTask(buildJob({
      episodeId: 'episode-1',
    }))).rejects.toThrow('FINAL_VIDEO_RENDER_BGM_REQUIRED')

    expect(generateMusicMock).not.toHaveBeenCalled()
    expect(storageMock.getObjectBuffer).not.toHaveBeenCalledWith('music/bgm-score.m4a')
    expect(storageMock.uploadObject).not.toHaveBeenCalled()
    expect(prismaMock.projectEpisodeFinalOutput.upsert).toHaveBeenCalledTimes(1)
  })

  it('replays a persisted final output without composing the video again', async () => {
    prismaMock.projectEpisodeFinalOutput.findFirst.mockResolvedValueOnce({ outputMediaId: 'media-final' })
    mediaServiceMock.getMediaObjectById.mockResolvedValueOnce({
      id: 'media-final',
      url: '/m/final-video',
      storageKey: 'video/final.mp4',
      durationMs: 3000,
      width: 1920,
      height: 1080,
    })
    const { handleFinalVideoRenderTask } = await import('@/lib/workers/final-video-render')

    const result = await handleFinalVideoRenderTask(buildJob({ episodeId: 'episode-1' }))

    expect(result).toMatchObject({ videoMediaId: 'media-final', durationSeconds: 3 })
    expect(execFileMock).not.toHaveBeenCalled()
    expect(prismaMock.projectEpisodeFinalOutput.upsert).not.toHaveBeenCalled()
  })
})
