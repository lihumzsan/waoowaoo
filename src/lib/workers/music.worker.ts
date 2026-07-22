import { Worker, type Job } from 'bullmq'
import { queueRedis } from '@/lib/redis'
import { generateMusic } from '@/lib/ai-exec/engine'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { uploadObject } from '@/lib/storage'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'
import { getTaskDefinitionForQueue, type MusicTaskHandlerKey } from '@/lib/task/definition'
import { QUEUE_NAME } from '@/lib/task/queues'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress, withTaskLifecycle } from './shared'
import { getWorkerConcurrency } from './runtime-config'
import { extensionFromAudioMimeType, loadGeneratedAudio } from './audio-artifact'

type MusicPayload = {
  musicModel?: unknown
  prompt?: unknown
  durationSeconds?: unknown
  vocalMode?: unknown
  genre?: unknown
  mood?: unknown
  bpm?: unknown
  outputFormat?: unknown
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`MUSIC_GENERATE_${field.toUpperCase()}_INVALID`)
  }
  return value
}

function readOptionalInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`MUSIC_GENERATE_${field.toUpperCase()}_INVALID`)
  }
  return value
}

function readOptionalEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`MUSIC_GENERATE_${field.toUpperCase()}_INVALID`)
  }
  return value as T
}

export async function handleMusicGenerateTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as MusicPayload
  const musicModel = readString(payload.musicModel)
  const prompt = readString(payload.prompt)
  const durationSeconds = readPositiveInteger(payload.durationSeconds, 'durationSeconds')
  if (!musicModel) throw new Error('MUSIC_GENERATE_MODEL_REQUIRED')
  if (!prompt) throw new Error('MUSIC_GENERATE_PROMPT_REQUIRED')

  const vocalMode = readOptionalEnum(payload.vocalMode, ['instrumental', 'vocal'] as const, 'vocalMode')
  const outputFormat = readOptionalEnum(payload.outputFormat, ['mp3', 'wav'] as const, 'outputFormat')
  const bpm = readOptionalInteger(payload.bpm, 'bpm')
  const genre = readString(payload.genre)
  const mood = readString(payload.mood)

  await reportTaskProgress(job, 20, { stage: 'generate_music_submit' })

  const generated = await generateMusic(job.data.userId, musicModel, prompt, {
    durationSeconds,
    ...(vocalMode ? { vocalMode } : {}),
    ...(genre ? { genre } : {}),
    ...(mood ? { mood } : {}),
    ...(typeof bpm === 'number' ? { bpm } : {}),
    ...(outputFormat ? { outputFormat } : {}),
  }, { key: 'media:music:primary' })
  if (!generated.success) {
    throw new Error(generated.error || 'MUSIC_GENERATE_PROVIDER_FAILED')
  }

  await reportTaskProgress(job, 85, { stage: 'persist_music' })

  const audio = await loadGeneratedAudio({
    audioBase64: generated.audioBase64,
    audioUrl: generated.audioUrl,
    mimeType: generated.audioMimeType,
    label: 'generated music',
    errorPrefix: 'MUSIC_GENERATE',
  })
  const storageKey = await uploadObject(
    audio.buffer,
    buildTaskArtifactStorageKey({
      taskId: job.data.taskId,
      artifact: 'music:primary',
      extension: extensionFromAudioMimeType(audio.mimeType),
    }),
    1,
    audio.mimeType,
  )
  const media = await ensureMediaObjectFromStorageKey(storageKey, {
    mimeType: audio.mimeType,
    sizeBytes: audio.buffer.byteLength,
    durationMs: durationSeconds * 1000,
  })

  return {
    mediaId: media.id,
    audioUrl: media.url,
    storageKey,
    modelKey: musicModel,
    musicModel,
    provider: musicModel.split('::')[0] || null,
    metadata: generated.metadata || {},
  }
}

type MusicTaskHandler = (job: Job<TaskJobData>) => Promise<Record<string, unknown> | void>

const MUSIC_TASK_HANDLERS = {
  creative_resource_audio: handleMusicGenerateTask,
} satisfies Record<MusicTaskHandlerKey, MusicTaskHandler>

async function processMusicTask(job: Job<TaskJobData>) {
  await reportTaskProgress(job, 5, { stage: 'received' })
  const definition = getTaskDefinitionForQueue(job.data.type, 'music')
  return await MUSIC_TASK_HANDLERS[definition.workerHandler](job)
}

export function createMusicWorker() {
  return new Worker<TaskJobData>(
    QUEUE_NAME.MUSIC,
    async (job) => await withTaskLifecycle(job, processMusicTask),
    {
      connection: queueRedis,
      concurrency: getWorkerConcurrency('music'),
    },
  )
}
