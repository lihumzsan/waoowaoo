import { generateMusic } from '@/lib/ai-exec/engine'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import {
  parseCreativeResourceGenerationTaskPayload,
  type CreativeResourceGenerationTaskPayload,
} from '@/lib/creative-resource/generation-contract'
import { resolveOwnedVideoHttpsForGeneration } from '@/lib/media/outbound-video'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { prisma } from '@/lib/prisma'
import { uploadObject } from '@/lib/storage'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'
import { extensionFromAudioMimeType, loadGeneratedAudio } from '../artifacts/audio'
import { reportTaskProgress } from '../progress'
import type { TaskExecutionContext } from '../context'
import { assertTaskActive, requireTaskProviderRouteSelection } from '../provider-media'

type MusicVideoReference = {
  readonly url: string
  readonly durationMs: number | null
}

async function loadMusicVideoReference(
  context: TaskExecutionContext,
  payload: CreativeResourceGenerationTaskPayload,
): Promise<MusicVideoReference | null> {
  const inputByPosition = new Map(
    payload.resource.inputs.map((reference) => [reference.position, reference]),
  )
  const videoInputs = payload.resource.videoInputPositions.map((position) => {
    const reference = inputByPosition.get(position)
    if (!reference) {
      throw new Error(`CREATIVE_RESOURCE_MUSIC_VIDEO_INPUT_POSITION_INVALID:${String(position)}`)
    }
    return reference
  })
  if (videoInputs.length === 0) return null
  const maxReferenceVideos = resolveBuiltinCapabilitiesByModelKey(
    'music',
    payload.resource.modelKey,
  )?.music?.maxReferenceVideos
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
  if (!resource) {
    throw new Error(`CREATIVE_RESOURCE_INPUT_NOT_FOUND:${reference.resourceId}`)
  }
  if (resource.userId !== context.data.userId || resource.status !== 'ready') {
    throw new Error(`CREATIVE_RESOURCE_INPUT_CHANGED:${reference.resourceId}`)
  }
  if (resource.mediaType !== 'video' || !resource.media?.storageKey) {
    throw new Error(`CREATIVE_RESOURCE_MUSIC_VIDEO_REFERENCE_REQUIRED:${reference.resourceId}`)
  }
  return {
    url: await resolveOwnedVideoHttpsForGeneration(resource.media.storageKey, context.data.userId),
    durationMs: resource.media.durationMs ?? null,
  }
}

export async function handleCreativeResourceAudioTask(context: TaskExecutionContext) {
  const { data } = context
  if (data.targetType !== 'CreativeResource') {
    throw new Error(`CREATIVE_RESOURCE_TASK_TARGET_INVALID:${data.targetType}`)
  }
  const payload = parseCreativeResourceGenerationTaskPayload(data.payload ?? {})
  if (
    payload.resource.resourceId !== data.targetId ||
    payload.resource.mediaType !== 'audio' ||
    payload.musicModel !== payload.resource.modelKey
  ) {
    throw new Error(`CREATIVE_RESOURCE_MUSIC_TASK_CONTRACT_INVALID:${data.taskId}`)
  }
  const musicModel = payload.resource.modelKey
  const prompt = payload.resource.prompt
  const durationSeconds = payload.durationSeconds
  if (!durationSeconds || durationSeconds <= 0) {
    throw new Error('MUSIC_GENERATE_DURATIONSECONDS_INVALID')
  }

  const videoReference = await loadMusicVideoReference(context, payload)
  await reportTaskProgress(context, 20, { stage: 'generate_music_submit' })

  const invocationKey = 'media:music:primary'
  const generated = await generateMusic(
    data.userId,
    musicModel,
    prompt,
    {
      durationSeconds,
      ...(payload.vocalMode ? { vocalMode: payload.vocalMode } : {}),
      ...(payload.genre ? { genre: payload.genre } : {}),
      ...(payload.mood ? { mood: payload.mood } : {}),
      ...(typeof payload.bpm === 'number' ? { bpm: payload.bpm } : {}),
      ...(payload.outputFormat ? { outputFormat: payload.outputFormat } : {}),
      ...(videoReference
        ? {
            referenceVideoUrl: videoReference.url,
            referenceVideoDurationMs:
              videoReference.durationMs ?? Math.round(durationSeconds * 1000),
            ...(payload.scoreCue
              ? {
                  scoreWindowStartMs: payload.scoreCue.startMs,
                  scoreWindowEndMs: payload.scoreCue.endMs,
                }
              : {}),
          }
        : {}),
    },
    { key: invocationKey },
    {
      beforePoll: async () => await assertTaskActive(context, 'polling_external'),
      onPending: async ({ elapsedRatio, phase }) => {
        const progress = 30 + Math.floor((80 - 30) * elapsedRatio)
        await reportTaskProgress(context, progress, {
          stage: 'polling_external',
          externalPhase: phase,
        })
        await assertTaskActive(context, 'polling_external_wait')
      },
    },
  )
  if (!generated.success) {
    throw new Error(generated.error || 'MUSIC_GENERATE_PROVIDER_FAILED')
  }
  const providerRoute = await requireTaskProviderRouteSelection(context, invocationKey)

  await reportTaskProgress(context, 85, { stage: 'persist_music' })
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
      taskId: data.taskId,
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
    modelKey: providerRoute.modelKey,
    musicModel: providerRoute.modelKey,
    provider: providerRoute.provider,
    metadata: generated.metadata || {},
  }
}
