import { describe, expect, it } from 'vitest'
import { findBuiltinCapabilities } from '@/lib/model-capabilities/catalog'

describe('comfyui video capabilities catalog', () => {
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
})
