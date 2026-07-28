import { Worker, type Job } from 'bullmq'
import { queueRedis } from '@/lib/redis'
import { generateMusic } from '@/lib/ai-exec/engine'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import {
  parseCreativeResourceGenerationTaskPayload,
  type CreativeResourceGenerationTaskPayload,
} from '@/lib/creative-resource/generation-contract'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { prisma } from '@/lib/prisma'
import { getSignedUrl, uploadObject } from '@/lib/storage'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'
import { getTaskDefinitionForQueue, type MusicTaskHandlerKey } from '@/lib/task/definition'
import { QUEUE_NAME } from '@/lib/task/queues'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress, withTaskLifecycle } from './shared'
import { getWorkerConcurrency } from './runtime-config'
import { extensionFromAudioMimeType, loadGeneratedAudio } from './audio-artifact'

type MusicVideoReference = {
  readonly url: string
  readonly durationMs: number | null
}

async function loadMusicVideoReference(
  job: Job<TaskJobData>,
  payload: CreativeResourceGenerationTaskPayload,
): Promise<MusicVideoReference | null> {
  const inputByPosition = new Map(payload.resource.inputs.map((reference) => [reference.position, reference]))
  const videoInputs = payload.resource.videoInputPositions.map((position) => {
    const reference = inputByPosition.get(position)
    if (!reference) throw new Error(`CREATIVE_RESOURCE_MUSIC_VIDEO_INPUT_POSITION_INVALID:${String(position)}`)
    return reference
  })
  if (videoInputs.length === 0) return null
  const maxReferenceVideos = resolveBuiltinCapabilitiesByModelKey('music', payload.resource.modelKey)
    ?.music?.maxReferenceVideos
  if (!maxReferenceVideos || videoInputs.length > maxReferenceVideos) {
    throw new Error(
      `MUSIC_MODEL_VIDEO_REFERENCE_LIMIT_EXCEEDED:${payload.resource.modelKey}:${String(videoInputs.length)}:${String(maxReferenceVideos ?? 0)}`,
    )
  }
  const reference = videoInputs[0]
  if (!reference) throw new Error('CREATIVE_RESOURCE_MUSIC_VIDEO_REFERENCE_REQUIRED')
  const resource = await prisma.creativeResource.findUnique({
    where: { id: reference.resourceId },
    select: {
      media: { select: { storageKey: true, durationMs: true } },
      userId: true,
      mediaType: true,
      status: true,
    },
  })
  if (!resource) throw new Error(`CREATIVE_RESOURCE_INPUT_NOT_FOUND:${reference.resourceId}`)
  if (resource.userId !== job.data.userId || resource.status !== 'ready') {
    throw new Error(`CREATIVE_RESOURCE_INPUT_CHANGED:${reference.resourceId}`)
  }
  if (resource.mediaType !== 'video' || !resource.media?.storageKey) {
    throw new Error(`CREATIVE_RESOURCE_MUSIC_VIDEO_REFERENCE_REQUIRED:${reference.resourceId}`)
  }
  return {
    url: await getSignedUrl(resource.media.storageKey, 3600),
    durationMs: resource.media.durationMs ?? null,
  }
}

export async function handleMusicGenerateTask(job: Job<TaskJobData>) {
  if (job.data.targetType !== 'CreativeResource') {
    throw new Error(`CREATIVE_RESOURCE_TASK_TARGET_INVALID:${job.data.targetType}`)
  }
  const payload = parseCreativeResourceGenerationTaskPayload(job.data.payload ?? {})
  if (
    payload.resource.resourceId !== job.data.targetId
    || payload.resource.mediaType !== 'audio'
    || payload.musicModel !== payload.resource.modelKey
  ) {
    throw new Error(`CREATIVE_RESOURCE_MUSIC_TASK_CONTRACT_INVALID:${job.data.taskId}`)
  }
  const musicModel = payload.resource.modelKey
  const prompt = payload.resource.prompt
  const durationSeconds = payload.durationSeconds
  if (!durationSeconds || durationSeconds <= 0) throw new Error('MUSIC_GENERATE_DURATIONSECONDS_INVALID')

  const videoReference = await loadMusicVideoReference(job, payload)

  await reportTaskProgress(job, 20, { stage: 'generate_music_submit' })

  const generated = await generateMusic(job.data.userId, musicModel, prompt, {
    durationSeconds,
    ...(payload.vocalMode ? { vocalMode: payload.vocalMode } : {}),
    ...(payload.genre ? { genre: payload.genre } : {}),
    ...(payload.mood ? { mood: payload.mood } : {}),
    ...(typeof payload.bpm === 'number' ? { bpm: payload.bpm } : {}),
    ...(payload.outputFormat ? { outputFormat: payload.outputFormat } : {}),
    ...(videoReference ? {
      referenceVideoUrl: videoReference.url,
      referenceVideoDurationMs: videoReference.durationMs ?? Math.round(durationSeconds * 1000),
    } : {}),
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
    durationMs: videoReference?.durationMs ?? durationSeconds * 1000,
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
