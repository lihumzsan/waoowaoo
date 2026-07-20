import { describe, expect, it } from 'vitest'
import { findBuiltinCapabilities } from '@/lib/model-capabilities/catalog'
import {
  normalizeVideoGenerationSelections,
  resolveEffectiveVideoCapabilityDefinitions,
} from '@/lib/model-capabilities/video-effective'

describe('comfyui video capabilities catalog', () => {
  it('registers Goon as the only selectable ComfyUI first-last-frame model', () => {
    const capabilities = findBuiltinCapabilities(
      'video',
      'comfyui',
      'basevideo/ltx23-profiles/goon-first-last-frame-2stage',
    )

    expect(capabilities?.video?.generationModeOptions).toEqual(['firstlastframe'])
    expect(capabilities?.video?.durationOptions).toEqual([
      4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ])
    expect(capabilities?.video?.fpsOptions).toEqual([24])
    expect(capabilities?.video?.resolutionOptions).toEqual(['720p'])
    expect(capabilities?.video?.firstlastframe).toBe(true)
    expect(capabilities?.video?.supportGenerateAudio).toBe(false)

    const definitions = resolveEffectiveVideoCapabilityDefinitions({
      videoCapabilities: capabilities?.video,
    })
    const defaultSelection = normalizeVideoGenerationSelections({ definitions })
    expect(defaultSelection.duration).toBe(4)
  })

  it('registers the current Smart VBVR LTX 2.3 workflow as a selectable video model', () => {
    const capabilities = findBuiltinCapabilities(
      'video',
      'comfyui',
      'basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
    )

    expect(capabilities?.video?.generationModeOptions).toEqual(['normal'])
    expect(capabilities?.video?.durationOptions).toEqual([4, 5, 6, 8, 10, 12, 16, 20])
    expect(capabilities?.video?.fpsOptions).toEqual([25])
    expect(capabilities?.video?.resolutionOptions).toEqual(['720p'])
    expect(capabilities?.video?.firstlastframe).toBe(false)
    expect(capabilities?.video?.supportGenerateAudio).toBe(false)
  })

  it('registers the KJ multi-shot PromptRelay workflow as fixed 720p at 25 fps', () => {
    const capabilities = findBuiltinCapabilities(
      'video',
      'comfyui',
      'basevideo/ltx23-profiles/t8-multishot-precise-promptrelay-kj-720p',
    )

    expect(capabilities?.video?.generationModeOptions).toEqual(['normal'])
    expect(capabilities?.video?.durationOptions).toEqual([4, 5, 6, 8, 10, 12, 16, 20])
    expect(capabilities?.video?.fpsOptions).toEqual([25])
    expect(capabilities?.video?.resolutionOptions).toEqual(['720p'])
    expect(capabilities?.video?.motionStrengthOptions).toEqual([1, 2, 3])
    expect(capabilities?.video?.firstlastframe).toBe(false)
    expect(capabilities?.video?.supportGenerateAudio).toBe(false)
    expect(capabilities?.video?.fieldI18n?.motionStrength?.optionLabelKeys).toEqual({
      1: 'capability.motionStrengthOption.1',
      2: 'capability.motionStrengthOption.2',
      3: 'capability.motionStrengthOption.3',
    })

    const definitions = resolveEffectiveVideoCapabilityDefinitions({
      videoCapabilities: capabilities?.video,
    })
    expect(normalizeVideoGenerationSelections({ definitions }).motionStrength).toBe(1)
  })

  it('registers Seedance2 Bernini 480p with motion strength controls', () => {
    for (const modelId of [
      'basevideo/seedance2/bernini-480p-i2v',
      'basevideo/seedance2/bernini-480p-i2v-audio-lipsync',
    ]) {
      const capabilities = findBuiltinCapabilities('video', 'comfyui', modelId)

      expect(capabilities?.video?.generationModeOptions).toEqual(['normal'])
      expect(capabilities?.video?.durationOptions).toEqual([5, 10])
      expect(capabilities?.video?.fpsOptions).toEqual([24])
      expect(capabilities?.video?.resolutionOptions).toEqual(['480p'])
      expect(capabilities?.video?.motionStrengthOptions).toEqual([1, 2, 3])
      expect(capabilities?.video?.firstlastframe).toBe(false)
      expect(capabilities?.video?.supportGenerateAudio).toBe(false)
      expect(capabilities?.video?.fieldI18n?.motionStrength?.optionLabelKeys).toEqual({
        1: 'capability.motionStrengthOption.1',
        2: 'capability.motionStrengthOption.2',
        3: 'capability.motionStrengthOption.3',
      })
    }
  })
})
