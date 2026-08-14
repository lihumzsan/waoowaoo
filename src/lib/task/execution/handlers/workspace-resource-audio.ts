import { generateMusic, generateSound } from '@/lib/ai-exec/engine'
import {
  parseWorkspaceResourceGenerationTaskPayload,
} from '@/lib/workspace-resource/generation-contract'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { uploadObject } from '@/lib/storage'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'
import { musicCompositionPlanDurationMs } from '@/lib/music/composition-plan'
import { extensionFromAudioMimeType, loadGeneratedAudio } from '../artifacts/audio'
import { materializeGeneratedMusic } from '../artifacts/music'
import { reportTaskProgress } from '../progress'
import type { TaskExecutionContext } from '../context'
import { assertTaskActive, requireTaskProviderRouteSelection } from '../provider-media'
import { parseFrozenAudioExecution } from '@/lib/workspace-resource/audio-execution-contract'

export async function handleWorkspaceResourceAudioTask(context: TaskExecutionContext) {
  const { data } = context
  if (data.targetType !== 'WorkspaceResource') {
    throw new Error(`WORKSPACE_RESOURCE_TASK_TARGET_INVALID:${data.targetType}`)
  }
  const payload = parseWorkspaceResourceGenerationTaskPayload(data.payload ?? {})
  if (payload.resource.resourceId !== data.targetId || payload.resource.mediaType !== 'audio') {
    throw new Error(`WORKSPACE_RESOURCE_AUDIO_TASK_CONTRACT_INVALID:${data.taskId}`)
  }
  const execution = parseFrozenAudioExecution({
    audioExecutionMode: payload.audioExecutionMode,
    audioKind: payload.resource.audioKind,
    prompt: payload.resource.prompt,
    durationSeconds: payload.durationSeconds,
    generationOptions: payload.generationOptions,
  })
  const audioKind = execution.audioKind
  const selectedModel = audioKind === 'sound' ? payload.soundModel : payload.musicModel
  if (selectedModel !== payload.resource.modelKey) {
    throw new Error(`WORKSPACE_RESOURCE_${audioKind.toUpperCase()}_TASK_CONTRACT_INVALID:${data.taskId}`)
  }
  const model = payload.resource.modelKey
  const durationMs = execution.mode === 'composition_music'
    ? musicCompositionPlanDurationMs(execution.generationOptions.compositionPlan)
    : execution.durationSeconds * 1000
  const durationSeconds = durationMs / 1000
  if (durationMs <= 0) {
    throw new Error(`${audioKind.toUpperCase()}_GENERATE_DURATIONSECONDS_INVALID`)
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
  const generated = await (async () => {
    switch (execution.mode) {
      case 'sound':
        return generateSound(
          data.userId,
          model,
          execution.prompt,
          execution.generationOptions,
          { key: invocationKey },
          wait,
        )
      case 'prompt_music':
        return generateMusic(
          data.userId,
          model,
          { kind: 'prompt', prompt: execution.prompt },
          execution.generationOptions,
          { key: invocationKey },
          wait,
        )
      case 'composition_music':
        return generateMusic(
          data.userId,
          model,
          { kind: 'composition_plan', compositionPlan: execution.generationOptions.compositionPlan },
          { outputFormat: execution.generationOptions.outputFormat },
          { key: invocationKey },
          wait,
        )
      default: {
        const exhaustive: never = execution
        throw new Error(`WORKSPACE_RESOURCE_AUDIO_EXECUTION_MODE_UNSUPPORTED:${String(exhaustive)}`)
      }
    }
  })()
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
  const materializedAudio = execution.mode === 'prompt_music'
    && typeof execution.generationOptions.providerDurationSeconds === 'number'
    ? await materializeGeneratedMusic({
        ...audio,
        requestedDurationSeconds: durationSeconds,
        providerDurationSeconds: execution.generationOptions.providerDurationSeconds,
      })
    : { ...audio, durationMs, plan: null }
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
