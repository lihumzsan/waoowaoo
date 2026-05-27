import { describe, expect, it } from 'vitest'
import { findBuiltinCapabilities } from '@/lib/model-capabilities/catalog'

describe('comfyui video capabilities catalog', () => {
  const expectComfyVideoProfile = (
    modelId: string,
    generationModeOptions: string[],
    durationOptions: number[],
    firstlastframe: boolean,
  ) => {
    const capabilities = findBuiltinCapabilities('video', 'comfyui', modelId)

    expect(capabilities?.video?.generationModeOptions).toEqual(generationModeOptions)
    expect(capabilities?.video?.durationOptions).toEqual(durationOptions)
    expect(capabilities?.video?.resolutionOptions).toEqual(['720p'])
    expect(capabilities?.video?.firstlastframe).toBe(firstlastframe)
    expect(capabilities?.video?.supportGenerateAudio).toBe(false)
  }

  it('registers the selectable LTX 2.3 workflow profiles with their supported modes and durations', () => {
    expectComfyVideoProfile(
      'basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
      ['normal'],
      [4, 5, 6, 8, 10, 12],
      false,
    )
    expectComfyVideoProfile(
      'basevideo/ltx23-profiles/t8-sulphur2-promptrelay-micro',
      ['normal'],
      [4, 5, 6, 8, 10, 12],
      false,
    )
    expectComfyVideoProfile(
      'basevideo/ltx23-profiles/t8-single-image-large-motion-4stage',
      ['normal'],
      [12, 16, 20],
      false,
    )
    expectComfyVideoProfile(
      'basevideo/ltx23-profiles/t8-smooth-first-last-frame',
      ['firstlastframe'],
      [4, 5, 6, 8, 10, 12],
      true,
    )
    expectComfyVideoProfile(
      'basevideo/ltx23-profiles/damaicha-image-to-30s-long-video',
      ['normal'],
      [12, 16, 20, 24, 30],
      false,
    )
    expectComfyVideoProfile(
      'basevideo/ltx23-profiles/damaicha-long-video-promptrelay',
      ['normal'],
      [12, 16, 20, 24],
      false,
    )
    expectComfyVideoProfile(
      'basevideo/ltx23-profiles/damaicha-aio-v2-no-subtitles',
      ['normal'],
      [6, 8, 10, 12],
      false,
    )
  })
})
