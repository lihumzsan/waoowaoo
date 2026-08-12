import { generateVoice } from '@/lib/ai-exec/engine'
import { parseWorkspaceResourceVoiceoverTaskPayload } from '@/lib/workspace-resource/voiceover-contract'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { probeMediaBufferDurationMs } from '@/lib/media/probe-duration'
import { uploadObject } from '@/lib/storage'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'
import { extensionFromAudioMimeType, loadGeneratedAudio } from '../artifacts/audio'
import { reportTaskProgress } from '../progress'
import type { TaskExecutionContext } from '../context'
import { assertTaskActive, requireTaskProviderRouteSelection } from '../provider-media'
import { resolveWorkspaceResourceInputMedia } from '@/lib/workspace-resource/input-media'

export async function handleWorkspaceResourceVoiceoverTask(context: TaskExecutionContext) {
  const { data } = context
  const payload = parseWorkspaceResourceVoiceoverTaskPayload(data.payload)
  if (data.targetType !== 'WorkspaceResource' || payload.resource.resourceId !== data.targetId) throw new Error(`WORKSPACE_RESOURCE_VOICEOVER_TASK_CONTRACT_INVALID:${data.taskId}`)
  const [reference] = await resolveWorkspaceResourceInputMedia({
    userId: data.userId,
    projectId: data.projectId,
    references: [{ ...payload.referenceAudio, role: 'reference_audio', position: 0 }],
    expectedMediaType: 'audio',
  })
  if (!reference || reference.durationMs === null || reference.durationMs < 3000 || reference.durationMs > 10000) throw new Error('VOICEOVER_REFERENCE_AUDIO_DURATION_INVALID')
  const generationOptions = payload.generationOptions
  if (
    reference.storageKey !== generationOptions.referenceAudio
    || reference.durationMs !== generationOptions.referenceAudioDurationMs
  ) throw new Error('VOICEOVER_REFERENCE_AUDIO_FROZEN_OPTIONS_MISMATCH')
  await reportTaskProgress(context, 15, { stage: 'voiceover_reference_ready' })
  const generated = await generateVoice(data.userId, payload.voiceModel, 'voiceover-reference', payload.text, {
    language: generationOptions.language,
    referenceAudio: generationOptions.referenceAudio,
    referenceAudioDurationMs: generationOptions.referenceAudioDurationMs,
    outputFormat: generationOptions.outputFormat,
  }, { key: 'media:voiceover:primary' }, {
    beforePoll: async () => await assertTaskActive(context, 'voiceover_polling_external'),
    onPending: async ({ elapsedRatio, phase }) => {
      await reportTaskProgress(context, 25 + Math.floor(55 * elapsedRatio), { stage: 'voiceover_polling_external', externalPhase: phase })
      await assertTaskActive(context, 'voiceover_polling_external_wait')
    },
  })
  if (!generated.success) throw new Error(generated.error || 'VOICEOVER_GENERATE_PROVIDER_FAILED')
  const providerRoute = await requireTaskProviderRouteSelection(context, 'media:voiceover:primary')
  const audio = await loadGeneratedAudio({ audioBase64: generated.audioBase64, audioUrl: generated.audioUrl, mimeType: generated.audioMimeType, label: 'generated voiceover', errorPrefix: 'VOICEOVER_GENERATE' })
  const extension = extensionFromAudioMimeType(audio.mimeType)
  const durationMs = await probeMediaBufferDurationMs({ buffer: audio.buffer, extension, stage: 'workspace_resource_voiceover_probe_duration' })
  const storageKey = await uploadObject(audio.buffer, buildTaskArtifactStorageKey({ taskId: data.taskId, artifact: `voiceover:${payload.resource.resourceId}`, extension }), audio.mimeType)
  const media = await ensureMediaObjectFromStorageKey(storageKey, { mimeType: audio.mimeType, sizeBytes: audio.buffer.byteLength, durationMs })
  return { mediaId: media.id, audioUrl: media.url, storageKey, modelKey: providerRoute.modelKey, provider: providerRoute.provider, durationMs, actualCharacters: Array.from(payload.text).length, metadata: generated.metadata || {} }
}
