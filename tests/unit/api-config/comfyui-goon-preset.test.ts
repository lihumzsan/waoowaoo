import { describe, expect, it } from 'vitest'
import { PRESET_MODELS } from '@/app/[locale]/profile/components/api-config/types'

describe('ComfyUI Goon settings helper', () => {
  it('registers the canonical Goon first-last-frame workflow in preset models', () => {
    const comfyUiVideoModelIds = PRESET_MODELS
      .filter((model) => model.provider === 'comfyui' && model.type === 'video')
      .map((model) => model.modelId)

    expect(comfyUiVideoModelIds).toContain('basevideo/ltx23-profiles/goon-first-last-frame-2stage')
    expect(comfyUiVideoModelIds).not.toContain('basevideo/ltx23-profiles/t8-smooth-first-last-frame')
  })
})
