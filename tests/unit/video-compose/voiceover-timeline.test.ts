import { describe, expect, it } from 'vitest'
import { validateVoiceoverTimeline } from '@/lib/video-compose/voiceover-timeline'

describe('voiceover timeline', () => {
  it('accepts touching segments', () => {
    expect(() => validateVoiceoverTimeline({ videoDurationMs: 10_000, items: [
      { resourceId: 'a', startSeconds: 0, durationMs: 2000 },
      { resourceId: 'b', startSeconds: 2, durationMs: 3000 },
    ] })).not.toThrow()
  })
  it('rejects overlap and video overflow', () => {
    expect(() => validateVoiceoverTimeline({ videoDurationMs: 10_000, items: [
      { resourceId: 'a', startSeconds: 0, durationMs: 2000 },
      { resourceId: 'b', startSeconds: 1, durationMs: 1000 },
    ] })).toThrow('VOICEOVER_TIMELINE_OVERLAP')
    expect(() => validateVoiceoverTimeline({ videoDurationMs: 1000, items: [
      { resourceId: 'a', startSeconds: 0.5, durationMs: 600 },
    ] })).toThrow('VOICEOVER_TIMELINE_OUTSIDE_VIDEO')
  })
})
