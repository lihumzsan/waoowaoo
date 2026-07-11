import type { Job } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'

const generateMusicMock = vi.hoisted(() => vi.fn())
const handleBgmScoreGenerateTaskMock = vi.hoisted(() => vi.fn())
const handleSoundscapePlanTaskMock = vi.hoisted(() => vi.fn())
const handleSoundscapeGenerateTaskMock = vi.hoisted(() => vi.fn())
const uploadObjectMock = vi.hoisted(() => vi.fn())
const ensureMediaObjectFromStorageKeyMock = vi.hoisted(() => vi.fn())
const reportTaskProgressMock = vi.hoisted(() => vi.fn())
const WorkerMock = vi.hoisted(() => vi.fn())

vi.mock('bullmq', () => ({
  Worker: WorkerMock,
}))

vi.mock('@/lib/ai-exec/engine', () => ({
  executeAiTextStep: vi.fn(),
  generateMusic: generateMusicMock,
}))

vi.mock('@/lib/bgm-score/generate', () => ({
  handleBgmScoreGenerateTask: handleBgmScoreGenerateTaskMock,
}))

vi.mock('@/lib/soundscape/generate', () => ({
  handleSoundscapePlanTask: handleSoundscapePlanTaskMock,
  handleSoundscapeGenerateTask: handleSoundscapeGenerateTaskMock,
}))

vi.mock('@/lib/storage', () => ({
  generateUniqueKey: vi.fn((prefix: string, ext: string) => `${prefix}/asset.${ext}`),
  toFetchableUrl: vi.fn((url: string) => url),
  uploadObject: uploadObjectMock,
}))

vi.mock('@/lib/media/service', () => ({
  ensureMediaObjectFromStorageKey: ensureMediaObjectFromStorageKeyMock,
}))

vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: reportTaskProgressMock,
  withTaskLifecycle: vi.fn(async (job: Job<TaskJobData>, fn: (innerJob: Job<TaskJobData>) => Promise<unknown>) => await fn(job)),
}))

vi.mock('@/lib/redis', () => ({
  queueRedis: {},
}))

function buildJob(payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    queueName: 'waoowaoo-music',
    data: {
      taskId: 'task-1',
      type: TASK_TYPE.MUSIC_GENERATE,
      locale: 'zh',
      projectId: 'project-1',
      targetType: 'Project',
      targetId: 'project-1',
      payload,
      userId: 'user-1',
    } satisfies TaskJobData,
  } as unknown as Job<TaskJobData>
}

function buildTypedJob(type: TaskJobData['type'], payload: Record<string, unknown>): Job<TaskJobData> {
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
    } satisfies TaskJobData,
  } as unknown as Job<TaskJobData>
}

describe('music worker', () => {
  it('generates music, uploads audio, creates MediaObject, and returns the media result', async () => {
    const { handleMusicGenerateTask } = await import('@/lib/workers/music.worker')
    generateMusicMock.mockResolvedValue({
      success: true,
      audioBase64: 'ZmFrZS1tcDM=',
      audioMimeType: 'audio/mpeg',
      metadata: { text: 'adapter notes' },
    })
    uploadObjectMock.mockResolvedValue('music/asset.mp3')
    ensureMediaObjectFromStorageKeyMock.mockResolvedValue({
      id: 'media-1',
      url: '/m/media-public-id',
    })

    const result = await handleMusicGenerateTask(buildJob({
      musicModel: 'google::lyria-3-pro-preview',
      prompt: 'tense chase cue',
      durationSeconds: 30,
      vocalMode: 'instrumental',
      outputFormat: 'mp3',
    }))

    expect(generateMusicMock).toHaveBeenCalledWith(
      'user-1',
      'google::lyria-3-pro-preview',
      'tense chase cue',
      {
        durationSeconds: 30,
        vocalMode: 'instrumental',
        outputFormat: 'mp3',
      },
      { key: 'media:music:primary' },
    )
    const uploadCall = uploadObjectMock.mock.calls[0]
    expect(uploadCall?.[1]).toBe(buildTaskArtifactStorageKey({
      taskId: 'task-1',
      artifact: 'music:primary',
      extension: 'mp3',
    }))
    expect(uploadCall?.[3]).toBe('audio/mpeg')
    expect(ensureMediaObjectFromStorageKeyMock).toHaveBeenCalledWith('music/asset.mp3', {
      mimeType: 'audio/mpeg',
      sizeBytes: 8,
      durationMs: 30000,
    })
    expect(result).toEqual({
      mediaId: 'media-1',
      audioUrl: '/m/media-public-id',
      storageKey: 'music/asset.mp3',
      musicModel: 'google::lyria-3-pro-preview',
      provider: 'google',
      metadata: { text: 'adapter notes' },
    })
  })

  it('routes soundscape plan and generation task types to their explicit handlers', async () => {
    const { createMusicWorker } = await import('@/lib/workers/music.worker')
    handleSoundscapePlanTaskMock.mockResolvedValue({ decision: 'soundscape' })
    handleSoundscapeGenerateTaskMock.mockResolvedValue({ mediaId: 'media-soundscape' })

    createMusicWorker()
    const processor = WorkerMock.mock.calls[0]?.[1] as ((job: Job<TaskJobData>) => Promise<unknown>) | undefined
    if (!processor) throw new Error('WORKER_PROCESSOR_NOT_REGISTERED')

    const planJob = buildTypedJob(TASK_TYPE.SOUNDSCAPE_PLAN, {
      episodeId: 'episode-1',
      soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
    })
    const generateJob = buildTypedJob(TASK_TYPE.SOUNDSCAPE_GENERATE, {
      episodeId: 'episode-1',
      soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
    })

    await processor(planJob)
    await processor(generateJob)

    expect(handleSoundscapePlanTaskMock).toHaveBeenCalledWith(planJob)
    expect(handleSoundscapeGenerateTaskMock).toHaveBeenCalledWith(generateJob)
  })
})
