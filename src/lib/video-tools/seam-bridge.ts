export const VIDEO_SEAM_BRIDGE_DURATIONS = [1, 2, 3, 4, 5, 6] as const

export const DEFAULT_VIDEO_SEAM_BRIDGE_DURATION = 1

export type VideoSeamBridgeDurationSeconds = typeof VIDEO_SEAM_BRIDGE_DURATIONS[number]

export type VideoSeamBridgeOptions = {
  durationSeconds: VideoSeamBridgeDurationSeconds
  prompt?: string
}

export function isVideoSeamBridgeDuration(value: unknown): value is VideoSeamBridgeDurationSeconds {
  return typeof value === 'number'
    && VIDEO_SEAM_BRIDGE_DURATIONS.includes(value as VideoSeamBridgeDurationSeconds)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function parseVideoSeamBridgeOptions(value: unknown): VideoSeamBridgeOptions {
  if (!isRecord(value)) throw new Error('VIDEO_SEAM_BRIDGE_REQUIRED')
  const durationSeconds = value.durationSeconds
  if (!isVideoSeamBridgeDuration(durationSeconds)) {
    throw new Error('VIDEO_SEAM_BRIDGE_DURATION_INVALID')
  }

  const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : ''
  return prompt ? { durationSeconds, prompt } : { durationSeconds }
}
