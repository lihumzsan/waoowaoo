import { generateMusic, generateSound } from '@/lib/ai-exec/engine'
import {
  parseWorkspaceResourceGenerationTaskPayload,
  type WorkspaceResourceGenerationTaskPayload,
} from '@/lib/workspace-resource/generation-contract'
import { resolveOwnedVideoUrlForGeneration } from '@/lib/media/outbound-video'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { resolveWorkspaceResourceInputMedia } from '@/lib/workspace-resource/input-media'
import { uploadObject } from '@/lib/storage'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'
import { extensionFromAudioMimeType, loadGeneratedAudio } from '../artifacts/audio'
import { materializeGeneratedMusic } from '../artifacts/music'
import { reportTaskProgress } from '../progress'
import type { TaskExecutionContext } from '../context'
import { assertTaskActive, requireTaskProviderRouteSelection } from '../provider-media'
import { isMusicKeyScale, isMusicTimeSignature } from '@/lib/workspace-resource/music-parameter-contract'

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
    url: await resolveOwnedVideoUrlForGeneration(resource.storageKey, context.data.userId),
    durationMs: resource.durationMs,
  }
}

export async function handleWorkspaceResourceAudioTask(context: TaskExecutionContext) {
  const { data } = context
  if (data.targetType !== 'WorkspaceResource') {
    throw new Error(`WORKSPACE_RESOURCE_TASK_TARGET_INVALID:${data.targetType}`)
  }
  const payload = parseWorkspaceResourceGenerationTaskPayload(data.payload ?? {})
  const audioKind = payload.resource.audioKind
  if (!audioKind) {
    throw new Error(`WORKSPACE_RESOURCE_AUDIO_KIND_REQUIRED:${data.taskId}`)
  }
  if (payload.resource.resourceId !== data.targetId || payload.resource.mediaType !== 'audio') {
    throw new Error(`WORKSPACE_RESOURCE_AUDIO_TASK_CONTRACT_INVALID:${data.taskId}`)
  }
  const selectedModel = audioKind === 'sound' ? payload.soundModel : payload.musicModel
  if (selectedModel !== payload.resource.modelKey) {
    throw new Error(`WORKSPACE_RESOURCE_${audioKind.toUpperCase()}_TASK_CONTRACT_INVALID:${data.taskId}`)
  }
  const model = payload.resource.modelKey
  const prompt = payload.resource.prompt
  const durationSeconds = payload.durationSeconds
  if (!durationSeconds || durationSeconds <= 0) {
    throw new Error(`${audioKind.toUpperCase()}_GENERATE_DURATIONSECONDS_INVALID`)
  }

  const videoReference = audioKind === 'music'
    ? await loadMusicVideoReference(context, payload)
    : null
  const options = payload.generationOptions
  if (audioKind === 'sound' && options.outputFormat !== 'mp3') {
    throw new Error('SOUND_GENERATE_OUTPUT_FORMAT_INVALID')
  }
  await reportTaskProgress(context, 20, {
    stage: audioKind === 'sound' ? 'generate_sound_submit' : 'generate_music_submit',
  })

  const invocationKey = audioKind === 'sound' ? 'media:sound:primary' : 'media:music:primary'
  const wait = {
    beforePoll: async () => await assertTaskActive(context, 'polling_external'),
    onPending: async ({ elapsedRatio, phase }: { elapsedRatio: number; phase: string }) => {
      const progress = 30 + Math.floor((80 - 30) * elapsedRatio)
      await reportTaskProgress(context, progress, {
        stage: 'polling_external',
        externalPhase: phase,
      })
      await assertTaskActive(context, 'polling_external_wait')
    },
  }
  const generated = audioKind === 'sound'
    ? await generateSound(
        data.userId,
        model,
        prompt,
        {
          durationSeconds,
          negativePrompt: payload.negativePrompt,
          outputFormat: 'mp3',
        },
        { key: invocationKey },
        wait,
      )
    : await generateMusic(
        data.userId,
        model,
        prompt,
        {
          durationSeconds,
          ...(typeof options.providerDurationSeconds === 'number'
            ? { providerDurationSeconds: options.providerDurationSeconds }
            : {}),
          ...(typeof options.negativePrompt === 'string'
            ? { negativePrompt: options.negativePrompt }
            : {}),
          ...(options.vocalMode === 'instrumental' || options.vocalMode === 'vocal'
            ? { vocalMode: options.vocalMode }
            : {}),
          ...(typeof options.genre === 'string' ? { genre: options.genre } : {}),
          ...(typeof options.mood === 'string' ? { mood: options.mood } : {}),
          ...(typeof options.bpm === 'number' ? { bpm: options.bpm } : {}),
          ...(isMusicKeyScale(options.keyScale) ? { keyScale: options.keyScale } : {}),
          ...(isMusicTimeSignature(options.timeSignature) ? { timeSignature: options.timeSignature } : {}),
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
        wait,
      )
  if (!generated.success) {
    throw new Error(generated.error || `${audioKind.toUpperCase()}_GENERATE_PROVIDER_FAILED`)
  }
  const providerRoute = await requireTaskProviderRouteSelection(context, invocationKey)

  await reportTaskProgress(context, 85, {
    stage: audioKind === 'sound' ? 'persist_sound' : 'persist_music',
  })
  const audio = await loadGeneratedAudio({
    audioBase64: generated.audioBase64,
    audioUrl: generated.audioUrl,
    mimeType: generated.audioMimeType,
    label: audioKind === 'sound' ? 'generated sound effect' : 'generated music',
    errorPrefix: audioKind === 'sound' ? 'SOUND_GENERATE' : 'MUSIC_GENERATE',
  })
  const materializedAudio = audioKind === 'music' && typeof options.providerDurationSeconds === 'number'
    ? await materializeGeneratedMusic({
        ...audio,
        requestedDurationSeconds: durationSeconds,
        providerDurationSeconds: options.providerDurationSeconds,
      })
    : { ...audio, durationMs: durationSeconds * 1000, plan: null }
  const storageKey = await uploadObject(
    materializedAudio.buffer,
    buildTaskArtifactStorageKey({
      taskId: data.taskId,
      artifact: audioKind === 'sound' ? 'sound:primary' : 'music:primary',
      extension: extensionFromAudioMimeType(materializedAudio.mimeType),
    }),
    materializedAudio.mimeType,
  )
  const media = await ensureMediaObjectFromStorageKey(storageKey, {
    mimeType: materializedAudio.mimeType,
    sizeBytes: materializedAudio.buffer.byteLength,
    durationMs: materializedAudio.durationMs,
  })

  return {
    mediaId: media.id,
    audioUrl: media.url,
    storageKey,
    modelKey: providerRoute.modelKey,
    ...(audioKind === 'sound'
      ? { soundModel: providerRoute.modelKey }
      : { musicModel: providerRoute.modelKey }),
    provider: providerRoute.provider,
    metadata: {
      ...(generated.metadata || {}),
      ...(materializedAudio.plan ? { musicArtifact: materializedAudio.plan } : {}),
    },
  }
}
