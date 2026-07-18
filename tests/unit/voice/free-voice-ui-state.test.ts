import { describe, expect, it } from 'vitest'
import {
  canSubmitFreeVoice,
  safeFreeVoiceFilename,
  selectCharacterDefaultVoice,
} from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video-stage/free-voice-state'

describe('free voice composer state', () => {
  it('selecting a character adopts its default reference voice', () => {
    expect(selectCharacterDefaultVoice({
      id: 'c1', name: '角色', customVoiceUrl: '/m/a',
    })).toEqual({
      sourceType: 'character',
      sourceId: 'c1',
      name: '角色',
      referenceAudioUrl: '/m/a',
    })
  })

  it('requires nonempty text, character, and reference audio', () => {
    expect(canSubmitFreeVoice({
      text: '  ', characterId: 'c1', voice: selectCharacterDefaultVoice({
        id: 'c1', name: '角色', customVoiceUrl: '/m/a',
      }),
    })).toBe(false)
  })

  it('builds a safe versioned download name', () => {
    expect(safeFreeVoiceFilename({ createdAt: '2026-07-13T08:00:00Z' }, {
      versionNumber: 3, audioUrl: '/m/a.mp3',
    })).toBe('free-voice-20260713-160000-v3.mp3')
  })
})
