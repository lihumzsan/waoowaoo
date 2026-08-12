import { describe, expect, it } from 'vitest'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { findBuiltinCapabilities, resolveGenerationOptionsForModel } from '@/lib/ai-registry/capabilities-catalog'
import { COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES, COMFYUI_H3_MODEL_ID } from '@/lib/ai-providers/comfyui/models'
import { H3_RUNTIME_PROFILES, resolveH3Dimensions, resolveH3DurationFrames } from '@/lib/ai-providers/comfyui/profiles'

describe('ComfyUI H3 profile math', () => {
  it('aligns duration to the H3 17k+5 frame grid', () => {
    expect(resolveH3DurationFrames(4)).toBe(107)
    expect(resolveH3DurationFrames(5)).toBe(124)
    expect(resolveH3DurationFrames(10)).toBe(243)
    expect(resolveH3DurationFrames(15)).toBe(362)
    expect(() => resolveH3DurationFrames(3)).toThrow('COMFYUI_H3_OPTION_UNSUPPORTED:duration=3')
    expect(() => resolveH3DurationFrames(16)).toThrow('COMFYUI_H3_OPTION_UNSUPPORTED:duration=16')
  })

  it('resolves ResolutionSelector Mi-pixel areas for 16:9 dimensions', () => {
    expect(resolveH3Dimensions({ resolution: '480p', aspectRatio: '16:9' })).toEqual({ width: 864, height: 480 })
    expect(resolveH3Dimensions({ resolution: '720p', aspectRatio: '16:9' })).toEqual({ width: 1376, height: 768 })
  })

  it('declares the generation modes supplied by the H3 workspace flow', () => {
    const h3 = COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES.find((entry) => entry.modelId === COMFYUI_H3_MODEL_ID)
    expect(h3?.capabilities.video.generationModeOptions).toEqual(['normal', 'firstlastframe'])
    expect(h3?.capabilities.video.promptProfile).toBe('minimax_h3_v1')
    expect(h3?.capabilities.video.durationOptions).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  })

  it('compiles the H3 normal 10-second selection through the production resolver', () => {
    ensureAiCatalogsRegistered()
    const capabilities = findBuiltinCapabilities('video', 'comfyui', COMFYUI_H3_MODEL_ID)
    if (!capabilities) throw new Error('COMFYUI_H3_CAPABILITIES_MISSING')
    const resolved = resolveGenerationOptionsForModel({
      modelType: 'video',
      modelKey: `comfyui::${COMFYUI_H3_MODEL_ID}`,
      capabilities,
      capabilityDefaults: {
        [`comfyui::${COMFYUI_H3_MODEL_ID}`]: {
          resolution: '720p',
          generateAudio: true,
        },
      },
      runtimeSelections: {
        generationMode: 'normal',
        duration: 10,
      },
    })
    expect(resolved.issues).toEqual([])
    expect(resolved.options).toMatchObject({
      generationMode: 'normal',
      duration: 10,
      resolution: '720p',
      generateAudio: true,
    })
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
