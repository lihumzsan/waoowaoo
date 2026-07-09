import type { Job } from 'bullmq'
import { writeFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import type { FinalRenderClipPlan } from '@/lib/video-compose/final-render-plan'
import { buildSoundscapeTimelineSignature } from '@/lib/soundscape/timeline'

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

  it('writes a soundscape plan and submits the generate task with loop billing payload', async () => {
    const { handleSoundscapePlanTask } = await import('@/lib/soundscape/generate')
    executeAiStructuredTextStepMock.mockResolvedValue({ data: soundscapePlan })

    const result = await handleSoundscapePlanTask(buildJob(TASK_TYPE.SOUNDSCAPE_PLAN, {
      episodeId: 'episode-1',
      soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
    }))

    expect(result).toMatchObject({
      episodeId: 'episode-1',
      decision: 'soundscape',
      sourceCount: 1,
      sectionCount: 1,
    })
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      type: TASK_TYPE.SOUNDSCAPE_GENERATE,
      operationId: 'generate_episode_soundscape',
      payload: expect.objectContaining({
        episodeId: 'episode-1',
        soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
        sourceCount: 1,
        loop: true,
        outputFormat: 'mp3_44100_128',
      }),
    }))
    expect(latestSoundscapeUpsertUpdate()).toMatchObject({
      status: 'planned',
      timelineSignature,
      soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
      planJson: soundscapePlan,
    })
  })

  it('generates loop sources, stores media records, renders a mix, and persists sourcesJson and mixJson', async () => {
    const { handleSoundscapeGenerateTask } = await import('@/lib/soundscape/generate')
    prismaMock.projectEditSoundscape.findUnique.mockResolvedValue({
      planJson: soundscapePlan,
      sourcesJson: [],
      timelineSignature,
    })

    const result = await handleSoundscapeGenerateTask(buildJob(TASK_TYPE.SOUNDSCAPE_GENERATE, {
      episodeId: 'episode-1',
      soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
    }))

    expect(generateSoundEffectMock).toHaveBeenCalledWith(
      'user-1',
      'elevenlabs::eleven_text_to_sound_v2',
      soundscapePlan.sources[0].prompt,
      {
        durationSeconds: 30,
        loop: true,
        promptInfluence: 0.55,
        outputFormat: 'mp3_44100_128',
      },
    )
    expect(ensureMediaObjectFromStorageKeyMock).toHaveBeenNthCalledWith(1, 'soundscape/source/asset.mp3', {
      mimeType: 'audio/mpeg',
      sizeBytes: Buffer.from('source-audio').byteLength,
      durationMs: 30000,
    })
    expect(ensureMediaObjectFromStorageKeyMock).toHaveBeenNthCalledWith(2, 'soundscape/mix/asset.m4a', {
      mimeType: 'audio/mp4',
      sizeBytes: Buffer.from('mix-audio').byteLength,
      durationMs: 30000,
    })
    expect(result).toMatchObject({
      episodeId: 'episode-1',
      mediaId: 'media-mix-1',
      audioUrl: '/m/soundscape-mix',
      storageKey: 'soundscape/mix/asset.m4a',
      soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
      sourceCount: 1,
      sectionCount: 1,
      durationMs: 30000,
    })
    expect(latestSoundscapeUpsertUpdate()).toMatchObject({
      status: 'completed',
      timelineSignature,
      planJson: soundscapePlan,
      mixJson: {
        mediaId: 'media-mix-1',
        url: '/m/soundscape-mix',
        storageKey: 'soundscape/mix/asset.m4a',
        mimeType: 'audio/mp4',
        durationMs: 30000,
      },
      sourcesJson: [expect.objectContaining({
        sourceId: 'city_wind',
        mediaId: 'media-source-1',
        storageKey: 'soundscape/source/asset.mp3',
        soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
      })],
    })
  })

  it('reuses an existing loop when the environment fingerprint and model match even if the prompt changed', async () => {
    const { handleSoundscapeGenerateTask } = await import('@/lib/soundscape/generate')
    const existingSource = {
      sourceId: 'previous_city_wind',
      environmentFingerprint: 'night_city_wind',
      prompt: 'Older seamless city wind loop prompt, no music, no voices, no footsteps.',
      mediaId: 'media-existing-source',
      url: '/m/existing-source',
      storageKey: 'soundscape/source/existing.mp3',
      mimeType: 'audio/mpeg',
      durationMs: 30000,
      loopDurationSeconds: 22,
      promptInfluence: 0.35,
      soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
    }
    prismaMock.projectEditSoundscape.findUnique.mockResolvedValue({
      planJson: soundscapePlan,
      sourcesJson: [existingSource],
      timelineSignature,
    })
    storageMock.uploadObject.mockReset()
    storageMock.uploadObject.mockResolvedValueOnce('soundscape/mix/asset.m4a')
    ensureMediaObjectFromStorageKeyMock.mockReset()
    ensureMediaObjectFromStorageKeyMock.mockResolvedValueOnce({
      id: 'media-mix-1',
      url: '/m/soundscape-mix',
    })

    const result = await handleSoundscapeGenerateTask(buildJob(TASK_TYPE.SOUNDSCAPE_GENERATE, {
      episodeId: 'episode-1',
      soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
    }))

    expect(generateSoundEffectMock).not.toHaveBeenCalled()
    expect(storageMock.getObjectBuffer).toHaveBeenCalledWith('soundscape/source/existing.mp3')
    expect(ensureMediaObjectFromStorageKeyMock).toHaveBeenCalledTimes(1)
    expect(ensureMediaObjectFromStorageKeyMock).toHaveBeenCalledWith('soundscape/mix/asset.m4a', {
      mimeType: 'audio/mp4',
      sizeBytes: Buffer.from('mix-audio').byteLength,
      durationMs: 30000,
    })
    expect(result).toMatchObject({
      episodeId: 'episode-1',
      sourceCount: 1,
      sectionCount: 1,
      storageKey: 'soundscape/mix/asset.m4a',
    })
    expect(latestSoundscapeUpsertUpdate()).toMatchObject({
      status: 'completed',
      sourcesJson: [expect.objectContaining({
        sourceId: 'city_wind',
        environmentFingerprint: 'night_city_wind',
        mediaId: 'media-existing-source',
        storageKey: 'soundscape/source/existing.mp3',
        prompt: existingSource.prompt,
      })],
    })
  })
})
