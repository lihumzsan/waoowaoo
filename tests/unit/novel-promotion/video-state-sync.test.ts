import { describe, expect, it } from 'vitest'
import { retainEqualJsonState } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/runtime/hooks/video-state-sync'

describe('retainEqualJsonState', () => {
  it('retains the previous reference for semantically equal state', () => {
    const previous = { mode: 'match_audio', voiceLineIds: ['voice-1'] }

    expect(retainEqualJsonState(previous, {
      mode: 'match_audio',
      voiceLineIds: ['voice-1'],
    })).toBe(previous)
  })

  it('returns changed state', () => {
    const previous = { duration: 5, fps: 24 }
    const next = { duration: 10, fps: 24 }

    expect(retainEqualJsonState(previous, next)).toBe(next)
  })
})
