import type { Job } from 'bullmq'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildBgmTimelineSignature } from '@/lib/bgm-score/timeline'

import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

import type { FinalRenderClipPlan } from '@/lib/video-compose/final-render-plan'

const execFileMock = vi.hoisted(() => vi.fn())

const readFileMock = vi.hoisted(() => vi.fn())

const prismaMock = vi.hoisted(() => ({
  projectEpisodeFinalOutput: {
    findFirst: vi.fn(async (): Promise<unknown> => ({
      renderStatus: 'processing',
      renderTaskId: 'task-1',
      outputMediaId: null,
    })),
    findUnique: vi.fn(),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  projectEditMusicScore: {
    findUnique: vi.fn(),
  },
  projectEditSoundscape: {
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
  getMediaObjectById: vi.fn(),
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
vi.mock('@/lib/workers/utils', () => ({
  assertTaskActive: vi.fn(async () => undefined),
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
  getMediaObjectById: mediaServiceMock.getMediaObjectById,
  resolveStorageKeyFromMediaValue: mediaServiceMock.resolveStorageKeyFromMediaValue,
}))

vi.mock('@/lib/storage', () => ({
  generateUniqueKey: storageMock.generateUniqueKey,
  getObjectBuffer: storageMock.getObjectBuffer,
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
        shotPurpose: 'action',
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
        dialogue: [],
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

export type { Job } from 'bullmq'
export { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
export { buildBgmTimelineSignature } from '@/lib/bgm-score/timeline'
export { TASK_TYPE } from '@/lib/task/types'
export type { TaskJobData } from '@/lib/task/types'
export type { FinalRenderClipPlan } from '@/lib/video-compose/final-render-plan'
export { buildCorePlan, buildDefaultChapterTimelineSignature, buildJob, execFileMock, executeAiTextStepMock, generateMusicMock, mediaServiceMock, prismaMock, readFileMock, reportTaskProgressMock, storageMock }
