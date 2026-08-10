import { describe, expect, it } from 'vitest'
import { H3_RUNTIME_PROFILES, resolveH3Dimensions, resolveH3DurationFrames } from '@/lib/ai-providers/comfyui/profiles'

describe('ComfyUI H3 profile math', () => {
  it('aligns duration to the H3 17k+5 frame grid', () => {
    expect(resolveH3DurationFrames(5)).toBe(124)
    expect(resolveH3DurationFrames(10)).toBe(243)
    expect(resolveH3DurationFrames(15)).toBe(362)
  })

  it('preserves aspect ratio while rounding dimensions to multiples of 32', () => {
    const dimensions = resolveH3Dimensions({ resolution: '480p', aspectRatio: '16:9' })
    expect(dimensions).toEqual({ width: 832, height: 480 })
    expect(dimensions.width % 32).toBe(0)
    expect(dimensions.height % 32).toBe(0)
  })

  it('keeps both production profiles wired to the verified H3 node and output', () => {
    for (const profile of Object.values(H3_RUNTIME_PROFILES)) {
      const classes = new Set(Object.values(profile.workflow).map((entry) => entry.class_type))
      for (const required of profile.requiredNodeClasses) expect(classes.has(required)).toBe(true)
      expect(profile.workflow[profile.h3NodeId]?.class_type).toBe('MiniMaxH3ImageToVideo')
      expect(profile.workflow[profile.outputNodeId]?.class_type).toBe('VHS_VideoCombine')
      const unet = Object.values(profile.workflow).find((entry) => entry.class_type === 'UNETLoader')
      expect(unet?.inputs.unet_name).toBe('h3\\minimax_h3_ref2va_int8_convrot.safetensors')
    }
  })
})
