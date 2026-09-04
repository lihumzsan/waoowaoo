import { describe, expect, it } from 'vitest'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { normalizeMediaOptionsForSelection } from '@/lib/ai-exec/media-preflight'
import { findBuiltinCapabilities, resolveGenerationOptionsForModel } from '@/lib/ai-registry/capabilities-catalog'
import { COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES, COMFYUI_H3_MODEL_ID } from '@/lib/ai-providers/comfyui/models'
import { H3_DUAL_STAGE_RUNTIME_PROFILE, resolveH3Dimensions } from '@/lib/ai-providers/comfyui/profiles'
import { resolveH3DurationPlan } from '@/lib/video-generation/h3-duration'

describe('ComfyUI H3 dual-stage profile', () => {
  it('aligns duration and fixed 1MP/2MP dimensions', () => {
    expect(resolveH3DurationPlan(4).frameCount).toBe(107)
    expect(resolveH3DurationPlan(5).frameCount).toBe(124)
    expect(resolveH3DurationPlan(10).frameCount).toBe(243)
    expect(resolveH3DurationPlan(13).frameCount).toBe(328)
    expect(resolveH3Dimensions({ megapixels: 1, aspectRatio: '16:9' })).toEqual({ width: 1376, height: 768 })
    expect(resolveH3Dimensions({ megapixels: 2, aspectRatio: '16:9' })).toEqual({ width: 1920, height: 1088 })
  })

  it('declares all three explicit H3 image input modes and fixed duration', () => {
    const h3 = COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES.find((entry) => entry.modelId === COMFYUI_H3_MODEL_ID)
    expect(h3?.capabilities.video.promptProfile).toBe('minimax_h3_multimodal_v3')
    expect(h3?.capabilities.video.supportedInputModes).toEqual([
      'reference',
      'first_frame',
      'first_last_frame',
    ])
    expect(h3?.capabilities.video.firstlastframe).toBe(true)
    expect(h3?.capabilities.video.assetReferenceMultiReference).toBe(true)
    expect(h3?.capabilities.video.maxReferenceImages).toBe(8)
    expect(h3?.capabilities.video.maxReferenceFiles).toBe(8)
    expect(h3?.capabilities.video.durationOptions).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
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

  it('rejects an H3 duration above thirteen seconds at provider preflight', () => {
    ensureAiCatalogsRegistered()
    const selection = { provider: 'comfyui' as const, modelId: COMFYUI_H3_MODEL_ID, modelKey: `comfyui::${COMFYUI_H3_MODEL_ID}`, variantSubKind: 'official' as const }
    const referenceImages = ['https://example.com/reference.png']
    expect(normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 13, aspectRatio: '9:16', generateAudio: true, referenceImages } })).toMatchObject({ duration: 13 })
    expect(() => normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 14, aspectRatio: '9:16', generateAudio: true, referenceImages } })).toThrow()
  })

  it('accepts frame transport and up to eight ordered references at the real ComfyUI option boundary', () => {
    const selection = { provider: 'comfyui' as const, modelId: COMFYUI_H3_MODEL_ID, modelKey: `comfyui::${COMFYUI_H3_MODEL_ID}`, variantSubKind: 'official' as const }
    const references = Array.from({ length: 8 }, (_, index) => `https://example.com/reference-${index + 1}.png`)
    expect(normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: true, referenceImages: references } })).toMatchObject({ duration: 4, referenceImages: references })
    expect(normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: true } })).toMatchObject({ duration: 4, generateAudio: true })
    expect(normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: true, lastFrameImageUrl: 'https://example.com/last.png' } })).toMatchObject({ lastFrameImageUrl: 'https://example.com/last.png' })
    expect(() => normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: true, referenceImages: Array.from({ length: 9 }, () => 'a') } })).toThrow()
    expect(() => normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: false } })).toThrow()
  })

  it('rejects an H3 duration above thirteen seconds at provider preflight', () => {
    ensureAiCatalogsRegistered()
    const selection = { provider: 'comfyui' as const, modelId: COMFYUI_H3_MODEL_ID, modelKey: `comfyui::${COMFYUI_H3_MODEL_ID}`, variantSubKind: 'official' as const }
    const referenceImages = ['https://example.com/reference.png']
    expect(normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 13, aspectRatio: '9:16', generateAudio: true, referenceImages } })).toMatchObject({ duration: 13 })
    expect(() => normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 14, aspectRatio: '9:16', generateAudio: true, referenceImages } })).toThrow()
  })

  it('keeps the canonical graph wired to the final output node', () => {
    const nodes = Object.values(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow)
    expect(nodes.filter((node) => node.class_type === 'easy clearCacheAll')).toHaveLength(2)
    expect(nodes.filter((node) => node.class_type === 'ImageResizeKJv2' && node.inputs.upscale_method === 'nvidia_rtx_vsr')).toHaveLength(2)
    expect(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow[H3_DUAL_STAGE_RUNTIME_PROFILE.h3NodeId]?.class_type).toBe('MiniMaxH3ReferenceToVideo')
    expect(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow[H3_DUAL_STAGE_RUNTIME_PROFILE.outputNodeId]?.class_type).toBe('VHS_VideoCombine')
  })
})
