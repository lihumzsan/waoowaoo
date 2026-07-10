import type { Job } from 'bullmq'

import { writeFile } from 'node:fs/promises'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

import type { FinalRenderClipPlan } from '@/lib/video-compose/final-render-plan'

import { buildSoundscapeTimelineSignature } from '@/lib/soundscape/timeline'

import { buildSoundscapePlanFingerprint, parseSoundscapePlanStrict } from '@/lib/soundscape/plan-contract'

const execFileMock = vi.hoisted(() => vi.fn())

const prismaMock = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(),
  },
  projectEpisode: {
    findFirst: vi.fn(),
  },
  projectEditSoundscape: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}))

const getProjectModelConfigMock = vi.hoisted(() => vi.fn())

const executeAiStructuredTextStepMock = vi.hoisted(() => vi.fn())

const generateSoundEffectMock = vi.hoisted(() => vi.fn())

const loadEpisodeChapterOutputClipsMock = vi.hoisted(() => vi.fn())

const submitTaskMock = vi.hoisted(() => vi.fn())

const reportTaskProgressMock = vi.hoisted(() => vi.fn())

const streamMock = vi.hoisted(() => ({
  flush: vi.fn(async () => undefined),
}))

const storageMock = vi.hoisted(() => ({
  generateUniqueKey: vi.fn((prefix: string, ext: string) => `${prefix}/asset.${ext}`),
  getObjectBuffer: vi.fn(),
  toFetchableUrl: vi.fn((url: string) => url),
  uploadObject: vi.fn(),
}))

const ensureMediaObjectFromStorageKeyMock = vi.hoisted(() => vi.fn())

const renderSoundscapeMixMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/config-service', () => ({
  getProjectModelConfig: getProjectModelConfigMock,
}))

vi.mock('@/lib/ai-exec/structured-step', () => ({
  executeAiStructuredTextStep: executeAiStructuredTextStepMock,
}))

vi.mock('@/lib/ai-exec/engine', () => ({
  generateSoundEffect: generateSoundEffectMock,
}))

vi.mock('@/lib/video-compose/episode-chapter-clips', () => ({
  loadEpisodeChapterOutputClips: loadEpisodeChapterOutputClipsMock,
}))

vi.mock('@/lib/task/submitter', () => ({
  submitTask: submitTaskMock,
}))

vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: reportTaskProgressMock,
}))

vi.mock('@/lib/llm-observe/internal-stream-context', () => ({
  withInternalLLMStreamCallbacks: vi.fn(async (_callbacks: unknown, fn: () => Promise<unknown>) => await fn()),
}))

vi.mock('@/lib/workers/handlers/llm-stream', () => ({
  createWorkerLLMStreamContext: vi.fn(() => ({ streamRunId: 'run-soundscape', nextSeqByStepLane: {} })),
  createWorkerLLMStreamCallbacks: vi.fn(() => streamMock),
}))

vi.mock('@/lib/storage', () => ({
  generateUniqueKey: storageMock.generateUniqueKey,
  getObjectBuffer: storageMock.getObjectBuffer,
  toFetchableUrl: storageMock.toFetchableUrl,
  uploadObject: storageMock.uploadObject,
}))

vi.mock('@/lib/media/service', () => ({
  ensureMediaObjectFromStorageKey: ensureMediaObjectFromStorageKeyMock,
}))

vi.mock('@/lib/soundscape/mixer', () => ({
  renderSoundscapeMix: renderSoundscapeMixMock,
}))

vi.mock('@/lib/video-compose/ffmpeg-binaries', () => ({
  buildFfmpegExecFileOptions: vi.fn((
    _execution: { readonly command: string },
    options: Record<string, unknown> = {},
  ) => options),
  resolveFfmpegBinary: vi.fn((binaryName: 'ffmpeg' | 'ffprobe') => ({ command: binaryName })),
}))

const clips: readonly FinalRenderClipPlan[] = [{
  panelId: 'chapter-1',
  groupId: null,
  sourceKind: 'panel',
  source: { storageKey: 'chapter-video/chapter-1.mp4' },
  durationSeconds: 3,
  order: 1,
  shotNumber: null,
  shotNumbers: [1],
  shotId: null,
  shotIds: ['shot-1'],
  description: 'Chapter 1',
  sound: null,
}]

const timelineSignature = buildSoundscapeTimelineSignature(clips)

const soundscapePlan = {
  schemaVersion: 1,
  decision: 'soundscape',
  sources: [{
    sourceId: 'city_wind',
    environmentFingerprint: 'night_city_wind',
    prompt: 'Seamless loop of steady city wind, no music, no voices, no footsteps.',
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
} as const

const soundscapePlanHash = buildSoundscapePlanFingerprint({
  plan: parseSoundscapePlanStrict(soundscapePlan),
  timelineSignature,
  soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
})

const approvedGeneratePayload = {
  episodeId: 'episode-1',
  soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
  timelineSignature,
  soundscapePlanHash,
  soundscapePlan,
}

function buildJob(type: TaskJobData['type'], payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    queueName: 'waoowaoo-music',
    data: {
      taskId: `task-${type}`,
      type,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'ProjectEpisode',
      targetId: 'episode-1',
      payload,
      userId: 'user-1',
      operationId: type === TASK_TYPE.SOUNDSCAPE_PLAN
        ? 'plan_episode_soundscape'
        : 'generate_episode_soundscape',
      operationSource: 'assistant-panel',
      operationConfirmed: true,
      operationRequestId: 'request-1',
      trace: { requestId: 'request-1' },
    } satisfies TaskJobData,
  } as unknown as Job<TaskJobData>
}

function latestSoundscapeUpsertUpdate(): Record<string, unknown> {
  const call = prismaMock.projectEditSoundscape.upsert.mock.calls.at(-1)
  if (!call) throw new Error('SOUNDSCAPE_UPSERT_NOT_CALLED')
  const arg = call[0] as { update?: Record<string, unknown> }
  return arg.update ?? {}
}

export type { Job } from 'bullmq'
export { writeFile } from 'node:fs/promises'
export { beforeEach, describe, expect, it, vi } from 'vitest'
export { TASK_TYPE } from '@/lib/task/types'
export type { TaskJobData } from '@/lib/task/types'
export type { FinalRenderClipPlan } from '@/lib/video-compose/final-render-plan'
export { buildSoundscapeTimelineSignature } from '@/lib/soundscape/timeline'
export { buildSoundscapePlanFingerprint, parseSoundscapePlanStrict } from '@/lib/soundscape/plan-contract'
export { approvedGeneratePayload, buildJob, clips, ensureMediaObjectFromStorageKeyMock, execFileMock, executeAiStructuredTextStepMock, generateSoundEffectMock, getProjectModelConfigMock, latestSoundscapeUpsertUpdate, loadEpisodeChapterOutputClipsMock, prismaMock, renderSoundscapeMixMock, reportTaskProgressMock, soundscapePlan, soundscapePlanHash, storageMock, streamMock, submitTaskMock, timelineSignature }
