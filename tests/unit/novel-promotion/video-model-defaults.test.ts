import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIDEO_MODEL_KEY,
  LEGACY_LTX23_VIDEO_MODEL_KEYS,
  normalizeDefaultVideoModel,
  normalizeVideoModelKey,
} from '@/lib/novel-promotion/video-model-defaults'

describe('video model defaults', () => {
  it('uses Bernini as the only default video model', () => {
    expect(DEFAULT_VIDEO_MODEL_KEY).toBe('comfyui::basevideo/seedance2/bernini-480p-i2v')
    expect(normalizeDefaultVideoModel(null)).toBe(DEFAULT_VIDEO_MODEL_KEY)
    expect(normalizeDefaultVideoModel('')).toBe(DEFAULT_VIDEO_MODEL_KEY)
  })

  it('normalizes every removed LTX2.3 workflow key to Bernini', () => {
    expect(LEGACY_LTX23_VIDEO_MODEL_KEYS).toContain(
      'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
    )
    for (const legacyKey of LEGACY_LTX23_VIDEO_MODEL_KEYS) {
      expect(normalizeVideoModelKey(legacyKey)).toBe(DEFAULT_VIDEO_MODEL_KEY)
      expect(normalizeVideoModelKey(legacyKey.replace('comfyui::', ''))).toBe(DEFAULT_VIDEO_MODEL_KEY)
    }
  })

  it('normalizes the Bernini audio lipsync workflow key to the base Bernini model', () => {
    expect(normalizeVideoModelKey('comfyui::basevideo/seedance2/bernini-480p-i2v-audio-lipsync')).toBe(DEFAULT_VIDEO_MODEL_KEY)
    expect(normalizeVideoModelKey('basevideo/seedance2/bernini-480p-i2v-audio-lipsync')).toBe(DEFAULT_VIDEO_MODEL_KEY)
  })

  it('keeps explicit non-legacy video model selections', () => {
    expect(normalizeVideoModelKey('ark::doubao-seedance-2-0-260128')).toBe('ark::doubao-seedance-2-0-260128')
  })
})
