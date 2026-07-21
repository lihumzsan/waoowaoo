export const VIDEO_SEAM_BRIDGE_DURATIONS = [1, 2, 3, 4, 5, 6] as const

export const DEFAULT_VIDEO_SEAM_BRIDGE_DURATION = 1

export const DEFAULT_VIDEO_SEAM_BRIDGE_MOTION_PROMPT = 'Create one continuous cinematic transition between the exact first and last frame. Begin visible motion immediately from the first generated frame and maintain perceptible camera, subject, and environment motion through every intermediate frame. When the endpoint compositions differ, continuously evolve framing, subjects, and setting toward the final frame instead of holding either reference image. Prioritize the exact endpoints. No cut, no dissolve, no fade, no overlay, no freeze frame, no static hold.'

export type VideoSeamBridgeDurationSeconds = typeof VIDEO_SEAM_BRIDGE_DURATIONS[number]

export type VideoSeamBridgeOptions = {
  durationSeconds: VideoSeamBridgeDurationSeconds
  prompt: string
}

export function isVideoSeamBridgeDuration(value: unknown): value is VideoSeamBridgeDurationSeconds {
  return typeof value === 'number'
    && VIDEO_SEAM_BRIDGE_DURATIONS.includes(value as VideoSeamBridgeDurationSeconds)
}

export function resolveVideoSeamBridgeMotionPrompt(value: unknown): string {
  const prompt = typeof value === 'string' ? value.trim() : ''
  return prompt || DEFAULT_VIDEO_SEAM_BRIDGE_MOTION_PROMPT
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

  return { durationSeconds, prompt: resolveVideoSeamBridgeMotionPrompt(value.prompt) }
}
