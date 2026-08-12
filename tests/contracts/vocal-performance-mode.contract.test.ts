import { describe, expect, it } from 'vitest'
import {
  assertVocalPerformancePrompt,
  resolveVideoVocalPerformanceMode,
  videoGenerationItemSchema,
  VOCAL_PERFORMANCE_MODES,
} from '@/lib/workspace-resource/generation-request'

const baseItem = {
  itemId: 'clip-1',
  name: 'Clip 1',
  folderPath: null,
  mediaType: 'video' as const,
  schemaId: 'generic.video',
  prompt: 'A simple shot.',
  count: 1,
  durationSeconds: 4,
}

describe('video vocal performance contract', () => {
  it('accepts exactly the four supported modes', () => {
    for (const mode of VOCAL_PERFORMANCE_MODES) {
      expect(videoGenerationItemSchema.parse({ ...baseItem, vocalPerformanceMode: mode }).vocalPerformanceMode)
        .toBe(mode)
    }
    expect(() => videoGenerationItemSchema.parse({ ...baseItem, vocalPerformanceMode: 'ambient_only' }))
      .toThrow()
  })

  it('keeps the item override optional for legacy requests and defaults explicitly', () => {
    expect(videoGenerationItemSchema.parse(baseItem).vocalPerformanceMode).toBeUndefined()
    expect(resolveVideoVocalPerformanceMode({})).toBe('native_dialogue')
    expect(resolveVideoVocalPerformanceMode({ projectDefault: 'voiceover' })).toBe('voiceover')
    expect(resolveVideoVocalPerformanceMode({ projectDefault: 'voiceover', itemOverride: 'silent_no_lip' }))
      .toBe('silent_no_lip')
  })

  it('rejects dialogue tags only for silent closed-lip mode', () => {
    expect(() => assertVocalPerformancePrompt({
      mode: 'silent_no_lip',
      prompt: 'The person says <d>[Chinese] 你好。</d>',
    })).toThrow('VIDEO_SILENT_NO_LIP_PROMPT_CONTAINS_DIALOGUE')
    expect(() => assertVocalPerformancePrompt({
      mode: 'native_dialogue',
      prompt: 'The person says <d>[Chinese] 你好。</d>',
    })).not.toThrow()
  })
})
