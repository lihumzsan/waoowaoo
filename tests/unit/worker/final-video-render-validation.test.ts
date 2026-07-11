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

  it('fails explicitly when soundscape state is missing before final render', async () => {
    prismaMock.projectEditSoundscape.findUnique.mockResolvedValue(null)
    const { handleFinalVideoRenderTask } = await import('@/lib/workers/final-video-render')

    await expect(handleFinalVideoRenderTask(buildJob({
      episodeId: 'episode-1',
    }))).rejects.toThrow('FINAL_VIDEO_RENDER_SOUNDSCAPE_REQUIRED')

    expect(storageMock.uploadObject).not.toHaveBeenCalled()
  })

  it('fails explicitly when soundscape generation failed', async () => {
    prismaMock.projectEditSoundscape.findUnique.mockResolvedValue({
      status: 'failed',
      timelineSignature: buildDefaultChapterTimelineSignature(),
      planJson: {
        schemaVersion: 1,
        decision: 'soundscape',
        sources: [],
        sections: [],
      },
      mixJson: null,
    })
    const { handleFinalVideoRenderTask } = await import('@/lib/workers/final-video-render')

    await expect(handleFinalVideoRenderTask(buildJob({
      episodeId: 'episode-1',
    }))).rejects.toThrow('FINAL_VIDEO_RENDER_SOUNDSCAPE_NOT_READY:failed')

    expect(storageMock.uploadObject).not.toHaveBeenCalled()
  })

  it('fails explicitly when chapter edit script structure is invalid', async () => {
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
          corePlanJson: { invalid: true },
        },
      },
    ])
    const { handleFinalVideoRenderTask } = await import('@/lib/workers/final-video-render')

    await expect(handleFinalVideoRenderTask(buildJob({
      episodeId: 'episode-1',
    }))).rejects.toThrow('EPISODE_CHAPTER_EDIT_SCRIPT_INVALID:chapter-1')

    expect(storageMock.uploadObject).not.toHaveBeenCalled()
  })

  it('fails explicitly instead of rendering without BGM while BGM is generating', async () => {
    prismaMock.projectEditMusicScore.findUnique.mockResolvedValue({
      status: 'generating',
      timelineSignature: buildDefaultChapterTimelineSignature(),
      mixJson: null,
    })
    const { handleFinalVideoRenderTask } = await import('@/lib/workers/final-video-render')

    await expect(handleFinalVideoRenderTask(buildJob({
      episodeId: 'episode-1',
    }))).rejects.toThrow('FINAL_VIDEO_RENDER_BGM_NOT_READY:generating')

    expect(storageMock.uploadObject).not.toHaveBeenCalled()
    expect(prismaMock.projectEpisodeFinalOutput.updateMany).not.toHaveBeenCalled()
  })
})
