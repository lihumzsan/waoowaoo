import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import { getProjectModelConfig } from '@/lib/config-service'

export interface CharacterVoiceDurationLimits {
  readonly minDurationMs: number
  readonly maxDurationMs: number
}

export async function readCharacterVoiceDurationLimits(input: {
  readonly projectId: string
  readonly userId: string
}): Promise<CharacterVoiceDurationLimits | null> {
  const config = await getProjectModelConfig(input.projectId, input.userId)
  const video = config.videoModel
    ? resolveBuiltinCapabilitiesByModelKey('video', config.videoModel)?.video
    : undefined
  if (
    video?.promptProfile !== 'minimax_h3_multimodal_v3'
    || !video.supportedInputModes?.includes('reference')
    || !video.maxReferenceAudios
    || video.minReferenceAudioDurationMs === undefined
    || video.maxTotalReferenceAudioDurationMs === undefined
  ) return null
  return {
    minDurationMs: video.minReferenceAudioDurationMs,
    maxDurationMs: video.maxTotalReferenceAudioDurationMs,
  }
}

export function isCharacterVoiceDurationAvailable(
  durationMs: number | null,
  limits: CharacterVoiceDurationLimits | null,
): boolean {
  return durationMs !== null && limits !== null
    && durationMs >= limits.minDurationMs && durationMs <= limits.maxDurationMs
}
