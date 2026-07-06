import type { Job } from 'bullmq'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildBgmTimelineSignature } from '@/lib/bgm-score/timeline'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import type { FinalRenderClipPlan } from '@/lib/video-compose/final-render-plan'

const execFileMock = vi.hoisted(() => vi.fn())
const readFileMock = vi.hoisted(() => vi.fn())
const prismaMock = vi.hoisted(() => ({
  projectEpisodeFinalOutput: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  projectEditMusicScore: {
    findUnique: vi.fn(),
  },
  project: {
    findUnique: vi.fn(),
  },
  projectEpisode: {
    findFirst: vi.fn(),
  },
  projectEditChapter: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
  },
  projectEditScript: {
    findUnique: vi.fn(),
  },
  projectEditBible: {
    findUnique: vi.fn(),
  },
  projectPanel: {
    findMany: vi.fn(),
  },
  projectVideoGroup: {
    findMany: vi.fn(),
  },
  userPreference: {
    findUnique: vi.fn(),
  },
}))

const reportTaskProgressMock = vi.hoisted(() => vi.fn())
const generateMusicMock = vi.hoisted(() => vi.fn())
const executeAiTextStepMock = vi.hoisted(() => vi.fn())
const mediaServiceMock = vi.hoisted(() => ({
  ensureMediaObjectFromStorageKey: vi.fn(),
  resolveStorageKeyFromMediaValue: vi.fn(),
}))
const storageMock = vi.hoisted(() => ({
  generateUniqueKey: vi.fn((prefix: string, ext: string) => `${prefix}/asset.${ext}`),
  getObjectBuffer: vi.fn(),
  toFetchableUrl: vi.fn((url: string) => url),
  uploadObject: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: readFileMock,
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: reportTaskProgressMock,
}))

vi.mock('@/lib/ai-exec/engine', () => ({
  executeAiTextStep: executeAiTextStepMock,
  generateMusic: generateMusicMock,
}))

vi.mock('@/lib/ai-registry/selection', () => ({
  parseModelKeyStrict: vi.fn((modelKey: string) => ({ modelKey })),
}))

vi.mock('@/lib/media/service', () => ({
  ensureMediaObjectFromStorageKey: mediaServiceMock.ensureMediaObjectFromStorageKey,
  resolveStorageKeyFromMediaValue: mediaServiceMock.resolveStorageKeyFromMediaValue,
}))

vi.mock('@/lib/storage', () => ({
  generateUniqueKey: storageMock.generateUniqueKey,
  getObjectBuffer: storageMock.getObjectBuffer,
  toFetchableUrl: storageMock.toFetchableUrl,
  uploadObject: storageMock.uploadObject,
}))

function buildJob(payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    queueName: 'waoowaoo-video',
    data: {
      taskId: 'task-1',
      type: TASK_TYPE.FINAL_VIDEO_RENDER,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'ProjectEpisode',
      targetId: 'episode-1',
      payload,
      userId: 'user-1',
    } satisfies TaskJobData,
  } as unknown as Job<TaskJobData>
}

function buildCorePlan() {
  return {
    shots: [
      {
        shotId: 'shot-1',
        shotNumber: 1,
        durationSec: 3,
        scene: {
          locationId: 'location-1',
          name: 'A scene',
          subScene: 'center workbench',
        },
        action: 'A shot',
        characters: [
          {
            characterId: 'character-1',
            name: 'Hero',
            visibility: 'visible',
            role: 'focus',
            performance: 'holds tension',
          },
        ],
        keyObjects: [],
        sound: 'tense pulse, sparse piano',
      },
    ],
    generationSegments: [
      {
        shotIds: ['shot-1'],
        continuity: 'single test shot',
      },
    ],
  }
}

function buildDefaultChapterTimelineSignature(): string {
  const clips: FinalRenderClipPlan[] = [
    {
      panelId: 'chapter-1',
      groupId: null,
      sourceKind: 'panel',
      source: {
        storageKey: 'chapter-video/chapter-1.mp4',
      },
      durationSeconds: 3,
      order: 1,
      shotNumber: null,
      shotNumbers: [1],
      shotId: null,
      shotIds: ['shot-1'],
      description: 'Chapter 1\nA rendered test chapter.',
      sound: null,
    },
  ]
  return buildBgmTimelineSignature(clips)
}

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
    expect(prismaMock.projectEpisodeFinalOutput.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { episodeId: 'episode-1' },
      update: expect.objectContaining({ renderStatus: 'failed', renderTaskId: 'task-1' }),
    }))
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

  it('renders final video without BGM when no completed mix exists', async () => {
    prismaMock.projectEditMusicScore.findUnique.mockResolvedValue(null)
    const { handleFinalVideoRenderTask } = await import('@/lib/workers/final-video-render')

    const result = await handleFinalVideoRenderTask(buildJob({
      episodeId: 'episode-1',
    }))

    expect(result).toMatchObject({
      videoMediaId: 'media-final',
      outputUrl: '/m/final-video',
      storageKey: 'final-video/asset.mp4',
    })
    expect(generateMusicMock).not.toHaveBeenCalled()
    expect(storageMock.getObjectBuffer).not.toHaveBeenCalledWith('music/bgm-score.m4a')
    const ffmpegCalls = execFileMock.mock.calls
      .filter((call) => call[0] === 'ffmpeg')
      .map((call) => (call[1] as readonly string[]).join(' '))
    expect(ffmpegCalls.some((args) => args.includes('loudnorm=I=-16.000'))).toBe(true)
    expect(ffmpegCalls.some((args) => args.includes('sidechaincompress'))).toBe(false)
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
    expect(prismaMock.projectEpisodeFinalOutput.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { episodeId: 'episode-1' },
      update: expect.objectContaining({ renderStatus: 'failed', renderTaskId: 'task-1' }),
    }))
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
    const completedFinalOutputCall = prismaMock.projectEpisodeFinalOutput.upsert.mock.calls.find((call) => {
      const arg = call[0] as { update?: { renderStatus?: string } }
      return arg.update?.renderStatus === 'completed'
    })
    expect(completedFinalOutputCall).toBeTruthy()
    expect(completedFinalOutputCall?.[0]).toEqual(expect.objectContaining({
      update: expect.objectContaining({
        renderStatus: 'completed',
        outputMediaId: 'media-final',
        outputUrl: '/m/final-video',
      }),
    }))
  })
})
