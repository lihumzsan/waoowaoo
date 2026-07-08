import type { Job } from 'bullmq'
import { writeFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const execFileMock = vi.hoisted(() => vi.fn())
const prismaMock = vi.hoisted(() => ({
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
  projectEditMusicScore: {
    upsert: vi.fn(),
  },
}))

const configServiceMock = vi.hoisted(() => ({
  getProjectModelConfig: vi.fn(),
}))
const executeAiTextStepMock = vi.hoisted(() => vi.fn())
const generateMusicMock = vi.hoisted(() => vi.fn())
const reportTaskProgressMock = vi.hoisted(() => vi.fn())
const streamMock = vi.hoisted(() => ({
  flush: vi.fn(async () => undefined),
}))
const mediaServiceMock = vi.hoisted(() => ({
  ensureMediaObjectFromStorageKey: vi.fn(),
}))
const storageMock = vi.hoisted(() => ({
  generateUniqueKey: vi.fn((prefix: string, ext: string) => `${prefix}/asset.${ext}`),
  toFetchableUrl: vi.fn((url: string) => url),
  uploadObject: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/config-service', () => configServiceMock)

vi.mock('@/lib/ai-exec/engine', () => ({
  executeAiTextStep: executeAiTextStepMock,
  generateMusic: generateMusicMock,
}))

vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: reportTaskProgressMock,
}))

vi.mock('@/lib/llm-observe/internal-stream-context', () => ({
  withInternalLLMStreamCallbacks: vi.fn(async (_callbacks: unknown, fn: () => Promise<unknown>) => await fn()),
}))

vi.mock('@/lib/workers/handlers/llm-stream', () => ({
  createWorkerLLMStreamContext: vi.fn(() => ({ streamRunId: 'run-1', nextSeqByStepLane: {} })),
  createWorkerLLMStreamCallbacks: vi.fn(() => streamMock),
}))

vi.mock('@/lib/media/service', () => ({
  ensureMediaObjectFromStorageKey: mediaServiceMock.ensureMediaObjectFromStorageKey,
}))

vi.mock('@/lib/storage', () => ({
  generateUniqueKey: storageMock.generateUniqueKey,
  toFetchableUrl: storageMock.toFetchableUrl,
  uploadObject: storageMock.uploadObject,
}))

function buildJob(payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    queueName: 'waoowaoo-music',
    data: {
      taskId: 'task-bgm-1',
      type: TASK_TYPE.MUSIC_SCORE_PLAN,
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

function buildCorePlan(sound: string = 'native video sound only') {
  return {
    shots: [
      {
        shotId: 'shot-1',
        shotNumber: 1,
        shotPurpose: 'action',
        durationSec: 3,
        scene: { locationId: 'location-room', name: 'A room', subScene: 'center of the room' },
        action: 'A shot',
        characters: [
          {
            characterId: 'character-hero',
            name: 'Hero',
            visibility: 'visible',
            role: 'focus',
            performance: 'holds still',
          },
        ],
        keyObjects: [],
        sound,
      },
    ],
    generationSegments: [
      {
        shotIds: ['shot-1'],
        continuity: 'A single continuous shot',
      },
    ],
  }
}

function mockReadyProject(): void {
  prismaMock.project.findUnique.mockResolvedValue({
    videoRatio: '16:9',
    artStyle: null,
    artStylePrompt: null,
    visualStylePresetSource: null,
    visualStylePresetId: null,
  })
  prismaMock.projectEpisode.findFirst.mockResolvedValue({ id: 'episode-1' })
  prismaMock.projectEditChapter.findUnique.mockResolvedValue({ id: 'chapter-1' })
  prismaMock.projectEditChapter.findMany.mockResolvedValue([
    {
      id: 'chapter-1',
      chapterIndex: 0,
      title: 'Chapter 1',
      summary: 'A single rendered test chapter.',
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
      userPrompt: 'test',
      styleBibleJson: null,
    },
    corePlanJson: buildCorePlan(),
  })
  prismaMock.projectEditBible.findUnique.mockResolvedValue({
    styleBibleJson: null,
  })
  configServiceMock.getProjectModelConfig.mockResolvedValue({
    analysisModel: 'openai::gpt-4.1',
  })
}

function mockCompleteTimeline(): void {
  prismaMock.projectPanel.findMany.mockResolvedValue([
    {
      id: 'panel-1',
      panelIndex: 0,
      panelNumber: 1,
      duration: 3,
      description: 'panel 1',
      videoUrl: 'https://example.com/panel-1.mp4',
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
}

function buildValidPlanText(): string {
  return JSON.stringify({
    durationSeconds: 3,
    creativeBrief: {
      cueType: 'continuous instrumental underscore',
      genre: 'minimal suspense drama',
      mood: 'tense and restrained',
      narrativeFunction: 'hold continuity while staying under native video sound',
    },
    scoreDesign: {
      overview: 'A single sparse cue with low tension, restrained harmony, and one tiny lift near the end.',
      sections: [
        {
          category: 'Cue Arc',
          title: 'Restrained suspense bed',
          purpose: 'Keep the scene connected without replacing source audio.',
          startSec: 0,
          endSec: 3,
          content: 'Slow 72 BPM implied pulse, D minor color, no literal effects.',
        },
        {
          category: 'Hit Point',
          title: 'End lift',
          purpose: 'Support the visual resolve.',
          startSec: 2.4,
          endSec: 3,
          content: 'Small harmonic swell, no impact sound.',
        },
      ],
    },
    virtualLayers: [
      {
        name: 'sustained harmonic bed',
        purpose: 'Provide the main emotional continuity.',
        content: 'Soft low strings and air pad, no independent melody.',
      },
      {
        name: 'restrained low weight',
        purpose: 'Add pressure without clutter.',
        content: 'Subtle low pedal below the video sound effects.',
      },
    ],
    promptSections: [
      {
        title: 'Main cue direction',
        purpose: 'Single final music prompt basis.',
        startSec: 0,
        endSec: 3,
        content: 'Generate a sparse suspense underscore in D minor, continuous for 3 seconds.',
      },
    ],
    finalPrompt: 'Generate one complete continuous instrumental cinematic BGM track for 3 seconds. Minimal suspense drama underscore in D minor, sparse low strings and air pad, restrained harmonic movement, tiny swell near 2.4 seconds, no literal sound effects, leave space for native video dialogue and sound.',
  })
}

describe('bgm score worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    execFileMock.mockImplementation((command: string, args: readonly string[], maybeCallback: unknown) => {
      if (typeof maybeCallback !== 'function') throw new Error('execFile callback missing')
      if (command === 'ffmpeg') {
        const outputPath = args[args.length - 1]
        if (typeof outputPath === 'string') {
          writeFileSync(outputPath, Buffer.from('mixed-bgm'))
        }
      }
      maybeCallback(null, { stdout: '3.500\n', stderr: '' })
    })
    storageMock.uploadObject.mockImplementation(async (_buffer: Buffer, key: string) => key)
    mediaServiceMock.ensureMediaObjectFromStorageKey.mockImplementation(async (storageKey: string) => ({
      id: storageKey.includes('music/bgm-score') ? 'media-mix' : `media-${storageKey}`,
      url: storageKey.includes('music/bgm-score') ? '/m/bgm-mix' : `/m/${storageKey}`,
    }))
  })

  it('generates BGM from the rendered chapter timeline', async () => {
    mockReadyProject()
    executeAiTextStepMock.mockResolvedValue({ text: buildValidPlanText() })
    generateMusicMock.mockResolvedValue({
      success: true,
      audioBase64: Buffer.from('draft-bgm').toString('base64'),
      audioMimeType: 'audio/mpeg',
    })

    const { handleBgmScoreGenerateTask } = await import('@/lib/bgm-score/generate')
    const result = await handleBgmScoreGenerateTask(buildJob({
      episodeId: 'episode-1',
      musicModel: 'google::lyria-3-pro-preview',
    }))

    expect(result).toMatchObject({
      episodeId: 'episode-1',
      mediaId: 'media-mix',
      audioUrl: '/m/bgm-mix',
      durationMs: 3500,
    })
    expect(executeAiTextStepMock).toHaveBeenCalledTimes(1)
    const planPrompt = String(executeAiTextStepMock.mock.calls[0]?.[0]?.messages?.[0]?.content)
    expect(planPrompt).toContain('"sourceKind": "panel"')
    expect(planPrompt).toContain('A single rendered test chapter.')
    expect(planPrompt).toContain('所有会显示在画布上的字段值必须使用中文自然语言')
    expect(generateMusicMock).toHaveBeenCalledTimes(1)
    expect(streamMock.flush).toHaveBeenCalled()
  })

  it('fails explicitly when no schedulable video timeline exists', async () => {
    mockReadyProject()
    prismaMock.projectEditChapter.findMany.mockResolvedValue([])

    const { handleBgmScoreGenerateTask } = await import('@/lib/bgm-score/generate')
    await expect(handleBgmScoreGenerateTask(buildJob({
      episodeId: 'episode-1',
      musicModel: 'google::lyria-3-pro-preview',
    }))).rejects.toThrow('EPISODE_CHAPTER_OUTPUTS_REQUIRED')

    expect(executeAiTextStepMock).not.toHaveBeenCalled()
    expect(generateMusicMock).not.toHaveBeenCalled()
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

  it('writes completed BGM after one final music generation request', async () => {
    mockReadyProject()
    mockCompleteTimeline()
    executeAiTextStepMock.mockResolvedValue({ text: buildValidPlanText() })
    generateMusicMock.mockResolvedValue({
      success: true,
      audioBase64: Buffer.from('final-bgm').toString('base64'),
      audioMimeType: 'audio/mpeg',
    })

    const { handleBgmScoreGenerateTask } = await import('@/lib/bgm-score/generate')
    const result = await handleBgmScoreGenerateTask(buildJob({
      episodeId: 'episode-1',
      musicModel: 'google::lyria-3-pro-preview',
    }))

    expect(result).toMatchObject({
      episodeId: 'episode-1',
      mediaId: 'media-mix',
      audioUrl: '/m/bgm-mix',
      designSectionCount: 2,
      promptSectionCount: 1,
      virtualLayerCount: 2,
    })
    expect(generateMusicMock).toHaveBeenCalledTimes(1)
    expect(String(generateMusicMock.mock.calls[0]?.[2])).toContain('Generate one complete continuous instrumental cinematic BGM track')
    expect(String(generateMusicMock.mock.calls[0]?.[2])).toContain('文本说明用内部编曲层')
    expect(storageMock.uploadObject).toHaveBeenCalledTimes(1)

    const completedCall = prismaMock.projectEditMusicScore.upsert.mock.calls.find((call) => {
      const arg = call[0] as {
        update?: {
          status?: string
          cuesJson?: {
            schemaVersion?: number
            plan?: { virtualLayers?: readonly unknown[]; promptSections?: readonly unknown[] }
          }
          mixJson?: { url?: string; durationMs?: number }
        }
      }
      return arg.update?.status === 'completed'
        && arg.update.cuesJson?.schemaVersion === 2
        && arg.update.mixJson?.url === '/m/bgm-mix'
        && arg.update.mixJson.durationMs === 3500
        && arg.update.cuesJson.plan?.virtualLayers?.length === 2
        && arg.update.cuesJson.plan?.promptSections?.length === 1
    })
    expect(completedCall).toBeTruthy()

    const progressCall = reportTaskProgressMock.mock.calls.find((call) => {
      const payload = call[2] as { stage?: string; designSectionCount?: number; promptSectionCount?: number }
      return payload.stage === 'music_score_plan_generate_music'
        && payload.designSectionCount === 2
        && payload.promptSectionCount === 1
    })
    expect(progressCall).toBeTruthy()
  })

  it('fails explicitly and skips upload when generated audio is shorter than the target timeline', async () => {
    mockReadyProject()
    mockCompleteTimeline()
    executeAiTextStepMock.mockResolvedValue({ text: buildValidPlanText() })
    generateMusicMock.mockResolvedValue({
      success: true,
      audioBase64: Buffer.from('short-bgm').toString('base64'),
      audioMimeType: 'audio/mpeg',
    })
    execFileMock.mockImplementation((_command: string, _args: readonly string[], maybeCallback: unknown) => {
      if (typeof maybeCallback !== 'function') throw new Error('execFile callback missing')
      maybeCallback(null, { stdout: '2.000\n', stderr: '' })
    })

    const { handleBgmScoreGenerateTask } = await import('@/lib/bgm-score/generate')
    await expect(handleBgmScoreGenerateTask(buildJob({
      episodeId: 'episode-1',
      musicModel: 'google::lyria-3-pro-preview',
    }))).rejects.toThrow('BGM_SCORE_CUE_AUDIO_DURATION_SHORT:cue-001:2.000:3.000')

    expect(storageMock.uploadObject).not.toHaveBeenCalled()
    const failedCall = prismaMock.projectEditMusicScore.upsert.mock.calls.find((call) => {
      const arg = call[0] as { update?: { status?: string; diagnosticsJson?: { errorMessage?: string } } }
      return arg.update?.status === 'failed'
        && arg.update.diagnosticsJson?.errorMessage === 'BGM_SCORE_CUE_AUDIO_DURATION_SHORT:cue-001:2.000:3.000'
    })
    expect(failedCall).toBeTruthy()
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
