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

  it('registers the LTX 2.3 first-last-frame workflow as firstlastframe-only', () => {
    const capabilities = findBuiltinCapabilities('video', 'comfyui', 'basevideo/首尾帧/ltx2.3首尾帧')

    expect(capabilities?.video?.generationModeOptions).toEqual(['firstlastframe'])
    expect(capabilities?.video?.durationOptions).toEqual([4, 5, 6, 8, 10, 12])
    expect(capabilities?.video?.resolutionOptions).toEqual(['720p'])
    expect(capabilities?.video?.firstlastframe).toBe(true)
  })

  it('registers the auto-enabled LTX 2.3 multi-shot VBVR workflow as normal video with 12 second support', () => {
    const capabilities = findBuiltinCapabilities('video', 'comfyui', 'basevideo/多镜头/Ltx2.3多镜头时间+逻辑控制PromptRelay和VBVR（KJ版）1')

    expect(capabilities?.video?.generationModeOptions).toEqual(['normal'])
    expect(capabilities?.video?.durationOptions).toEqual([4, 5, 6, 8, 10, 12])
    expect(capabilities?.video?.resolutionOptions).toEqual(['720p'])
    expect(capabilities?.video?.firstlastframe).toBe(false)
  })

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
