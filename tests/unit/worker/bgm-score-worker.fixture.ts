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

vi.mock('@/lib/video-compose/ffmpeg-binaries', () => ({
  buildFfmpegExecFileOptions: vi.fn((
    _execution: { readonly command: string },
    options: Record<string, unknown> = {},
  ) => options),
  resolveFfmpegBinary: vi.fn((binaryName: 'ffmpeg' | 'ffprobe') => ({ command: binaryName })),
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
        dialogue: [],
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

export type { Job } from 'bullmq'
export { writeFileSync } from 'node:fs'
export { beforeEach, describe, expect, it, vi } from 'vitest'
export { TASK_TYPE } from '@/lib/task/types'
export type { TaskJobData } from '@/lib/task/types'
export { buildCorePlan, buildJob, buildValidPlanText, configServiceMock, execFileMock, executeAiTextStepMock, generateMusicMock, mediaServiceMock, mockCompleteTimeline, mockReadyProject, prismaMock, reportTaskProgressMock, storageMock, streamMock }
