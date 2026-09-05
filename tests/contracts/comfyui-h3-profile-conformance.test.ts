import { describe, expect, it } from 'vitest'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { normalizeMediaOptionsForSelection } from '@/lib/ai-exec/media-preflight'
import { findBuiltinCapabilities, resolveGenerationOptionsForModel } from '@/lib/ai-registry/capabilities-catalog'
import { COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES, COMFYUI_H3_MODEL_ID } from '@/lib/ai-providers/comfyui/models'
import {
  H3_ASPECT_RATIOS,
  H3_DUAL_STAGE_RUNTIME_PROFILE,
  buildH3PromptGraph,
  resolveH3Dimensions,
} from '@/lib/ai-providers/comfyui/profiles'
import {
  resolveH3ContinuationDurationPlan,
  resolveH3DurationPlan,
} from '@/lib/video-generation/h3-duration'

describe('ComfyUI H3 dual-stage profile', () => {
  it('aligns duration and derives the delivery dimensions from the generation canvas', () => {
    expect(resolveH3DurationPlan(4).frameCount).toBe(107)
    expect(resolveH3DurationPlan(5).frameCount).toBe(124)
    expect(resolveH3DurationPlan(10).frameCount).toBe(243)
    expect(resolveH3DurationPlan(11).frameCount).toBe(277)
    expect(resolveH3Dimensions({ megapixels: 1, aspectRatio: '16:9' })).toEqual({ width: 1376, height: 768 })
    expect(resolveH3Dimensions({ megapixels: 2, aspectRatio: '16:9' })).toEqual({ width: 2064, height: 1152 })
  })

  it.each(H3_ASPECT_RATIOS)('keeps the effective %s delivery canvas aligned across every H3 input mode', (aspectRatio) => {
    const common = {
      prompt: 'subject_definitions:\nSubject 1 remains visually consistent.',
      aspectRatio,
      seed: 17,
    }
    const builds = [
      buildH3PromptGraph({
        ...common,
        frameCount: resolveH3DurationPlan(4).frameCount,
        mode: 'reference',
        referenceImageUrls: ['https://example.test/reference.png'],
        referenceAudioFilenames: [],
      }),
      buildH3PromptGraph({
        ...common,
        frameCount: resolveH3DurationPlan(4).frameCount,
        mode: 'first_frame',
        firstFrameUrl: 'https://example.test/first.png',
      }),
      buildH3PromptGraph({
        ...common,
        frameCount: resolveH3ContinuationDurationPlan(4).frameCount,
        mode: 'continuation',
        continuationFrameFilenames: Array.from(
          { length: 22 },
          (_, index) => `continuation-${String(index).padStart(2, '0')}.png`,
        ),
      }),
    ]

    for (const built of builds) {
      const generationNode = built.graph[built.profile.h3NodeId]
      const deliveryNode = built.graph[built.profile.finalUpscaleNodeId]
      const generationWidth = generationNode?.inputs.width
      const generationHeight = generationNode?.inputs.height
      const deliveryWidth = deliveryNode?.inputs.width
      const deliveryHeight = deliveryNode?.inputs.height
      const divisibleBy = deliveryNode?.inputs.divisible_by
      expect([
        generationWidth,
        generationHeight,
        deliveryWidth,
        deliveryHeight,
        divisibleBy,
      ].every(Number.isSafeInteger)).toBe(true)
      expect((deliveryWidth as number) % (divisibleBy as number)).toBe(0)
      expect((deliveryHeight as number) % (divisibleBy as number)).toBe(0)
      expect((generationWidth as number) * (deliveryHeight as number)).toBe(
        (generationHeight as number) * (deliveryWidth as number),
      )
    }
  })

  it('declares all four explicit H3 input modes and fixed duration', () => {
    const h3 = COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES.find((entry) => entry.modelId === COMFYUI_H3_MODEL_ID)
    expect(h3?.capabilities.video.promptProfile).toBe('minimax_h3_multimodal_v3')
    expect(h3?.capabilities.video.supportedInputModes).toEqual([
      'reference',
      'first_frame',
      'first_last_frame',
      'continuation',
    ])
    expect(h3?.capabilities.video.firstlastframe).toBe(true)
    expect(h3?.capabilities.video.assetReferenceMultiReference).toBe(true)
    expect(h3?.capabilities.video).toMatchObject({
      maxReferenceImages: 8,
      maxReferenceAudios: 3,
      maxReferenceVideos: 0,
      maxReferenceFiles: 11,
      referenceAudioRequiresVisual: true,
      minReferenceAudioDurationMs: 2_000,
      maxTotalReferenceAudioDurationMs: 15_000,
    })
    expect(h3?.capabilities.video.durationOptions).toEqual([4, 5, 6, 7, 8, 9, 10, 11])
    expect(h3?.capabilities.video.continuationInput).toMatchObject({
      minSourceDurationMs: 917,
      maxSourceDurationMs: 11_583,
      sourceAspectRatioByTarget: {
        '9:16': { width: 1152, height: 2064 },
      },
    })
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

  it('accepts frame transport and up to eight ordered references at the real ComfyUI option boundary', () => {
    const selection = { provider: 'comfyui' as const, modelId: COMFYUI_H3_MODEL_ID, modelKey: `comfyui::${COMFYUI_H3_MODEL_ID}`, variantSubKind: 'official' as const }
    const references = Array.from({ length: 8 }, (_, index) => `https://example.com/reference-${index + 1}.png`)
    const referenceAudios = Array.from({ length: 3 }, (_, index) => `https://example.com/reference-${index + 1}.mp3`)
    expect(normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: true, referenceImages: references } })).toMatchObject({ duration: 4, referenceImages: references })
    expect(normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: true, referenceImages: references.slice(0, 1), referenceAudios } })).toMatchObject({ referenceAudios })
    expect(normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: true } })).toMatchObject({ duration: 4, generateAudio: true })
    expect(normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: true, lastFrameImageUrl: 'https://example.com/last.png' } })).toMatchObject({ lastFrameImageUrl: 'https://example.com/last.png' })
    expect(normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: true, continuationVideoUrl: 'https://example.com/previous.mp4' } })).toMatchObject({ continuationVideoUrl: 'https://example.com/previous.mp4' })
    expect(() => normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: true, referenceImages: Array.from({ length: 9 }, () => 'a') } })).toThrow()
    expect(() => normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: true, referenceImages: references.slice(0, 1), referenceAudios: Array.from({ length: 4 }, () => 'a') } })).toThrow()
    expect(() => normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: true, referenceImages: references.slice(0, 1), referenceVideos: ['https://example.com/reference.mp4'] } })).toThrow()
    expect(() => normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: false } })).toThrow()
  })

  it('rejects an H3 duration above eleven seconds at provider preflight', () => {
    ensureAiCatalogsRegistered()
    const selection = { provider: 'comfyui' as const, modelId: COMFYUI_H3_MODEL_ID, modelKey: `comfyui::${COMFYUI_H3_MODEL_ID}`, variantSubKind: 'official' as const }
    const referenceImages = ['https://example.com/reference.png']
    expect(normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 11, aspectRatio: '9:16', generateAudio: true, referenceImages } })).toMatchObject({ duration: 11 })
    expect(() => normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 12, aspectRatio: '9:16', generateAudio: true, referenceImages } })).toThrow()
  })

  it('keeps the canonical graph wired to the final output node', () => {
    const nodes = Object.values(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow)
    expect(nodes.filter((node) => node.class_type === 'easy clearCacheAll')).toHaveLength(2)
    expect(nodes.filter((node) => node.class_type === 'ImageResizeKJv2' && node.inputs.upscale_method === 'nvidia_rtx_vsr')).toHaveLength(2)
    expect(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow[H3_DUAL_STAGE_RUNTIME_PROFILE.h3NodeId]?.class_type).toBe('MiniMaxH3ReferenceToVideo')
    expect(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow[H3_DUAL_STAGE_RUNTIME_PROFILE.outputNodeId]?.class_type).toBe('VHS_VideoCombine')
  })

  it('builds zero, one, and three ordered H3 reference-audio inputs and rejects a fourth', () => {
    const referenceInput = {
      prompt: 'subject_definitions:\n<Subject 1> is the person in <Picture 1>.',
      frameCount: 107,
      aspectRatio: '9:16',
      seed: 17,
      mode: 'reference',
      referenceImageUrls: ['https://example.test/reference.png'],
    } as const
    const zeroAudio = buildH3PromptGraph({
      ...referenceInput,
      referenceAudioFilenames: [],
    })
    const oneAudio = buildH3PromptGraph({
      ...referenceInput,
      referenceAudioFilenames: ['waoowaoo/prompt/reference-audio-00.mp3'],
    })
    const threeAudio = buildH3PromptGraph({
      ...referenceInput,
      referenceAudioFilenames: [
        'waoowaoo/prompt/reference-audio-00.mp3',
        'waoowaoo/prompt/reference-audio-01.wav',
        'waoowaoo/prompt/reference-audio-02.mp3',
      ],
    })

    expect(zeroAudio.graph['340']).toBeUndefined()
    expect(zeroAudio.graph['309']?.inputs['ref_audios.ref_audio_0']).toBeUndefined()
    expect(oneAudio.graph['340']).toEqual({
      class_type: 'LoadAudio',
      inputs: { audio: 'waoowaoo/prompt/reference-audio-00.mp3' },
    })
    expect(oneAudio.graph['309']?.inputs['ref_audios.ref_audio_0']).toEqual(['340', 0])
    expect(threeAudio.graph['309']?.inputs['ref_audios.ref_audio_2']).toEqual(['342', 0])
    expect(() => buildH3PromptGraph({
      ...referenceInput,
      referenceAudioFilenames: ['1.wav', '2.wav', '3.wav', '4.wav'],
    })).toThrow('COMFYUI_H3_REFERENCE_AUDIOS_COUNT_INVALID:3')
  })
})
