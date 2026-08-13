export type VoiceoverTimelineItem = {
  readonly startSeconds: number
  readonly durationMs: number
  readonly resourceId: string
}

export function validateVoiceoverTimeline(input: {
  readonly items: readonly VoiceoverTimelineItem[]
  readonly videoDurationMs: number
}): void {
  if (!Number.isFinite(input.videoDurationMs) || input.videoDurationMs <= 0) throw new Error('VOICEOVER_VIDEO_DURATION_INVALID')
  const ordered = [...input.items].sort((a, b) => a.startSeconds - b.startSeconds)
  let previousEndMs = 0
  for (const item of ordered) {
    if (!Number.isFinite(item.startSeconds) || item.startSeconds < 0 || !Number.isFinite(item.durationMs) || item.durationMs <= 0) throw new Error('VOICEOVER_TIMELINE_DURATION_INVALID')
    const startMs = Math.round(item.startSeconds * 1000)
    const endMs = startMs + Math.round(item.durationMs)
    if (startMs < previousEndMs) throw new Error('VOICEOVER_TIMELINE_OVERLAP')
    if (endMs > input.videoDurationMs) throw new Error('VOICEOVER_TIMELINE_OUTSIDE_VIDEO')
    previousEndMs = endMs
  }
}
