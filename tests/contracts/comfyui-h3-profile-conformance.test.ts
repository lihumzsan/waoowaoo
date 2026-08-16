import { describe, expect, it } from 'vitest'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { normalizeMediaOptionsForSelection } from '@/lib/ai-exec/media-preflight'
import { findBuiltinCapabilities, resolveGenerationOptionsForModel } from '@/lib/ai-registry/capabilities-catalog'
import { COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES, COMFYUI_H3_MODEL_ID } from '@/lib/ai-providers/comfyui/models'
import { H3_DUAL_STAGE_RUNTIME_PROFILE, resolveH3Dimensions, resolveH3DurationFrames } from '@/lib/ai-providers/comfyui/profiles'

describe('ComfyUI H3 dual-stage profile', () => {
  it('aligns duration and fixed 1MP/2MP dimensions', () => {
    expect(resolveH3DurationFrames(4)).toBe(107)
    expect(resolveH3DurationFrames(5)).toBe(124)
    expect(resolveH3DurationFrames(10)).toBe(243)
    expect(resolveH3DurationFrames(15)).toBe(362)
    expect(resolveH3Dimensions({ megapixels: 1, aspectRatio: '16:9' })).toEqual({ width: 1376, height: 768 })
    expect(resolveH3Dimensions({ megapixels: 2, aspectRatio: '16:9' })).toEqual({ width: 1920, height: 1088 })
  })

  it('declares reference-only H3 capability and fixed duration', () => {
    const h3 = COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES.find((entry) => entry.modelId === COMFYUI_H3_MODEL_ID)
    expect(h3?.capabilities.video.promptProfile).toBe('minimax_h3_reference_v2')
    expect(h3?.capabilities.video.supportedInputModes).toEqual(['reference'])
    expect(h3?.capabilities.video.maxReferenceImages).toBe(1)
    expect(h3?.capabilities.video.maxReferenceFiles).toBe(1)
    expect(h3?.capabilities.video.durationOptions).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  })

  it('compiles the ordinary reference selection through the production resolver', () => {
    ensureAiCatalogsRegistered()
    const capabilities = findBuiltinCapabilities('video', 'comfyui', COMFYUI_H3_MODEL_ID)
    if (!capabilities) throw new Error('COMFYUI_H3_CAPABILITIES_MISSING')
    const resolved = resolveGenerationOptionsForModel({
      modelType: 'video', modelKey: `comfyui::${COMFYUI_H3_MODEL_ID}`, capabilities,
      capabilityDefaults: { [`comfyui::${COMFYUI_H3_MODEL_ID}`]: { generateAudio: true } },
      runtimeSelections: { duration: 10 },
    })
    expect(resolved.issues).toEqual([])
    expect(resolved.options).toMatchObject({ duration: 10, generateAudio: true })
  })

  it('accepts one reference image at the real ComfyUI option boundary', () => {
    const selection = { provider: 'comfyui' as const, modelId: COMFYUI_H3_MODEL_ID, modelKey: `comfyui::${COMFYUI_H3_MODEL_ID}`, variantSubKind: 'official' as const }
    expect(normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: true, referenceImages: ['https://example.com/reference.png'] } })).toMatchObject({ duration: 4, referenceImages: ['https://example.com/reference.png'] })
    expect(() => normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: true } })).toThrow()
    expect(() => normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: true, referenceImages: ['a', 'b'] } })).toThrow()
  })

  it('keeps the canonical graph wired to the final output node', () => {
    const nodes = Object.values(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow)
    const classes = new Set(nodes.map((entry) => entry.class_type))
    for (const required of H3_DUAL_STAGE_RUNTIME_PROFILE.requiredNodeClasses) expect(classes.has(required)).toBe(true)
    expect(nodes.filter((node) => node.class_type === 'easy clearCacheAll')).toHaveLength(2)
    expect(nodes.filter((node) => node.class_type === 'ImageResizeKJv2' && node.inputs.upscale_method === 'nvidia_rtx_vsr')).toHaveLength(2)
    expect(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow[H3_DUAL_STAGE_RUNTIME_PROFILE.h3NodeId]?.class_type).toBe('MiniMaxH3ReferenceToVideo')
    expect(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow[H3_DUAL_STAGE_RUNTIME_PROFILE.outputNodeId]?.class_type).toBe('VHS_VideoCombine')
  })
})
