import { generateMusic } from '@/lib/ai-exec/engine'
import {
  parseWorkspaceResourceGenerationTaskPayload,
  type WorkspaceResourceGenerationTaskPayload,
} from '@/lib/workspace-resource/generation-contract'
import { resolveOwnedVideoHttpsForGeneration } from '@/lib/media/outbound-video'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { resolveWorkspaceResourceInputMedia } from '@/lib/workspace-resource/input-media'
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
  payload: WorkspaceResourceGenerationTaskPayload,
): Promise<MusicVideoReference | null> {
  const inputByPosition = new Map(
    payload.resource.inputs.map((reference) => [reference.position, reference]),
  )
  const videoInputs = payload.resource.videoInputPositions.map((position) => {
    const reference = inputByPosition.get(position)
    if (!reference) {
      throw new Error(`WORKSPACE_RESOURCE_MUSIC_VIDEO_INPUT_POSITION_INVALID:${String(position)}`)
    }
    return reference
  })
  if (videoInputs.length === 0) return null
  const reference = videoInputs[0]
  if (!reference) throw new Error('WORKSPACE_RESOURCE_MUSIC_VIDEO_REFERENCE_REQUIRED')
  const [resource] = await resolveWorkspaceResourceInputMedia({
    userId: context.data.userId,
    projectId: context.data.projectId,
    references: [reference],
    expectedMediaType: 'video',
  })
  if (!resource) {
    throw new Error(`WORKSPACE_RESOURCE_INPUT_NOT_FOUND:${reference.resourceId}`)
  }
  return {
    url: await resolveOwnedVideoHttpsForGeneration(resource.storageKey, context.data.userId),
    durationMs: resource.durationMs,
  }
}

export async function handleWorkspaceResourceAudioTask(context: TaskExecutionContext) {
  const { data } = context
  if (data.targetType !== 'WorkspaceResource') {
    throw new Error(`WORKSPACE_RESOURCE_TASK_TARGET_INVALID:${data.targetType}`)
  }
  const payload = parseWorkspaceResourceGenerationTaskPayload(data.payload ?? {})
  if (
    payload.resource.resourceId !== data.targetId ||
    payload.resource.mediaType !== 'audio' ||
    payload.musicModel !== payload.resource.modelKey
  ) {
    throw new Error(`WORKSPACE_RESOURCE_MUSIC_TASK_CONTRACT_INVALID:${data.taskId}`)
  }
  const musicModel = payload.resource.modelKey
  const prompt = payload.resource.prompt
  const durationSeconds = payload.durationSeconds
  if (!durationSeconds || durationSeconds <= 0) {
    throw new Error('MUSIC_GENERATE_DURATIONSECONDS_INVALID')
  }

  const videoReference = await loadMusicVideoReference(context, payload)
  const options = payload.generationOptions
  await reportTaskProgress(context, 20, { stage: 'generate_music_submit' })

  const invocationKey = 'media:music:primary'
  const generated = await generateMusic(
    data.userId,
    musicModel,
    prompt,
    {
      durationSeconds,
      ...(typeof options.negativePrompt === 'string'
        ? { negativePrompt: options.negativePrompt }
        : {}),
      ...(options.vocalMode === 'instrumental' || options.vocalMode === 'vocal'
        ? { vocalMode: options.vocalMode }
        : {}),
      ...(typeof options.genre === 'string' ? { genre: options.genre } : {}),
      ...(typeof options.mood === 'string' ? { mood: options.mood } : {}),
      ...(typeof options.bpm === 'number' ? { bpm: options.bpm } : {}),
      ...(options.outputFormat === 'mp3' || options.outputFormat === 'wav'
        ? { outputFormat: options.outputFormat }
        : {}),
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
