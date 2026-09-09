import { describe, expect, it } from 'vitest'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { normalizeMediaOptionsForSelection } from '@/lib/ai-exec/media-preflight'
import {
  findBuiltinCapabilities,
  getCapabilityOptionFields,
  resolveGenerationOptionsForModel,
} from '@/lib/ai-registry/capabilities-catalog'
import { COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES, COMFYUI_H3_MODEL_ID } from '@/lib/ai-providers/comfyui/models'
import { comfyuiAdapter } from '@/lib/ai-providers/comfyui/adapter'
import {
  H3_ASPECT_RATIOS,
  H3_DUAL_STAGE_RUNTIME_PROFILE,
  buildH3PromptGraph,
  resolveH3Dimensions,
} from '@/lib/ai-providers/comfyui/profiles'
import {
  resolveH3DurationPlan,
} from '@/lib/video-generation/h3-duration'

describe('ComfyUI H3 dual-stage profile', () => {
  it('uses the prepared-only adapter path so local work finishes before the submission fence', () => {
    expect(comfyuiAdapter.video?.prepare).toBeTypeOf('function')
    expect(comfyuiAdapter.video?.execute).toBeUndefined()
  })

  it('aligns duration and derives the delivery dimensions from the generation canvas', () => {
    expect(resolveH3DurationPlan({ inputMode: 'first_frame', requestedDurationSeconds: 4 }).frameCount).toBe(107)
    expect(resolveH3DurationPlan({ inputMode: 'reference', requestedDurationSeconds: 4 }).frameCount).toBe(107)
    expect(resolveH3DurationPlan({ inputMode: 'reference', requestedDurationSeconds: 5 }).frameCount).toBe(124)
    expect(resolveH3DurationPlan({ inputMode: 'reference', requestedDurationSeconds: 10 }).frameCount).toBe(243)
    expect(resolveH3DurationPlan({ inputMode: 'reference', requestedDurationSeconds: 15 }).frameCount).toBe(362)
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
        frameCount: resolveH3DurationPlan({ inputMode: 'first_frame', requestedDurationSeconds: 4 }).frameCount,
        mode: 'first_frame',
        firstFrameUrl: 'https://example.test/first.png',
      }),
      buildH3PromptGraph({
        ...common,
        frameCount: resolveH3DurationPlan({ inputMode: 'continuation', requestedDurationSeconds: 4 }).frameCount,
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

  it.each(H3_ASPECT_RATIOS)('accepts both Ref and frame-mode %s delivery ratios as continuation sources', (aspectRatio) => {
    const h3 = COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES.find((entry) => (
      entry.modelType === 'video' && entry.modelId === COMFYUI_H3_MODEL_ID
    ))
    const declaredSourceRatios = h3?.capabilities.video.continuationInput
      ?.sourceAspectRatiosByTarget[aspectRatio] ?? []
    const common = {
      prompt: 'subject_definitions:\nSubject 1 remains visually consistent.',
      aspectRatio,
      seed: 17,
      frameCount: resolveH3DurationPlan({ inputMode: 'reference', requestedDurationSeconds: 4 }).frameCount,
    }
    const builds = [
      buildH3PromptGraph({
        ...common,
        mode: 'reference' as const,
        requestedDurationSeconds: 4,
        referenceImageFilenames: ['reference-00.png'],
        referenceAudioFilenames: [],
      }),
      buildH3PromptGraph({
        ...common,
        mode: 'first_frame' as const,
        firstFrameUrl: 'https://example.test/first.png',
      }),
    ]

    for (const built of builds) {
      const deliveryNode = built.graph[built.profile.finalUpscaleNodeId]
      const width = deliveryNode?.inputs.width as number
      const height = deliveryNode?.inputs.height as number
      expect(declaredSourceRatios.some((candidate) => (
        width * candidate.height === height * candidate.width
      ))).toBe(true)
    }
  })

  it('declares all four explicit H3 input modes and fixed duration', () => {
    const h3 = COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES.find((entry) => (
      entry.modelType === 'video' && entry.modelId === COMFYUI_H3_MODEL_ID
    ))
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
      maxReferenceImages: 9,
      maxReferenceAudios: 3,
      maxReferenceVideos: 0,
      maxReferenceFiles: 12,
      referenceAudioRequiresVisual: true,
      minReferenceAudioDurationMs: 2_000,
      maxTotalReferenceAudioDurationMs: 15_000,
    })
    expect(h3?.capabilities.video.supportedAspectRatios).toEqual(H3_ASPECT_RATIOS)
    ensureAiCatalogsRegistered()
    const registeredCapabilities = findBuiltinCapabilities('video', 'comfyui', COMFYUI_H3_MODEL_ID)
    expect(getCapabilityOptionFields('video', registeredCapabilities)).not.toHaveProperty('aspectRatio')
    expect(h3?.capabilities.video.inputModePolicies).toEqual({
      reference: { durationOptions: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
      first_frame: { durationOptions: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
      first_last_frame: { durationOptions: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
      continuation: { durationOptions: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
    })
    expect(h3?.capabilities.video.continuationInput).toMatchObject({
      minSourceDurationMs: 917,
      maxSourceDurationMs: 15_625,
      sourceAspectRatiosByTarget: {
        '9:16': [
          { width: 1152, height: 2064 },
          { width: 1088, height: 1920 },
        ],
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
      runtimeSelections: { aspectRatio: '9:16' },
    })
    expect(resolved.issues).toEqual([])
    expect(resolved.options).toMatchObject({ aspectRatio: '9:16', generateAudio: true })
  })

  it('rejects a persisted model-level ratio instead of silently treating it as project state', () => {
    ensureAiCatalogsRegistered()
    const capabilities = findBuiltinCapabilities('video', 'comfyui', COMFYUI_H3_MODEL_ID)
    if (!capabilities) throw new Error('COMFYUI_H3_CAPABILITIES_MISSING')

    const resolved = resolveGenerationOptionsForModel({
      modelType: 'video', modelKey: `comfyui::${COMFYUI_H3_MODEL_ID}`, capabilities,
      capabilityDefaults: {
        [`comfyui::${COMFYUI_H3_MODEL_ID}`]: { generateAudio: true, aspectRatio: '21:9' },
      },
      runtimeSelections: { aspectRatio: '16:9' },
    })

    expect(resolved.options).toEqual({})
    expect(resolved.issues).toEqual([
      expect.objectContaining({
        code: 'CAPABILITY_FIELD_INVALID',
        field: `capabilities.comfyui::${COMFYUI_H3_MODEL_ID}.aspectRatio`,
      }),
    ])
  })

  it('accepts frame transport and up to nine ordered references at the real ComfyUI option boundary', () => {
    const selection = { provider: 'comfyui' as const, modelId: COMFYUI_H3_MODEL_ID, modelKey: `comfyui::${COMFYUI_H3_MODEL_ID}`, variantSubKind: 'official' as const }
    const references = Array.from({ length: 9 }, (_, index) => `https://example.com/reference-${index + 1}.png`)
    const referenceAudios = Array.from({ length: 3 }, (_, index) => `https://example.com/reference-${index + 1}.mp3`)
    expect(normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: true, referenceImages: references } })).toMatchObject({ duration: 4, referenceImages: references })
    expect(normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: true, referenceImages: references.slice(0, 1), referenceAudios } })).toMatchObject({ referenceAudios })
    expect(normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: true } })).toMatchObject({ duration: 4, generateAudio: true })
    expect(normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: true, lastFrameImageUrl: 'https://example.com/last.png' } })).toMatchObject({ lastFrameImageUrl: 'https://example.com/last.png' })
    expect(normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: true, continuationVideoUrl: 'https://example.com/previous.mp4' } })).toMatchObject({ continuationVideoUrl: 'https://example.com/previous.mp4' })
    expect(() => normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: true, referenceImages: Array.from({ length: 10 }, () => 'a') } })).toThrow()
    expect(() => normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: true, referenceImages: references.slice(0, 1), referenceAudios: Array.from({ length: 4 }, () => 'a') } })).toThrow()
    expect(() => normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: true, referenceImages: references.slice(0, 1), referenceVideos: ['https://example.com/reference.mp4'] } })).toThrow()
    expect(() => normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 4, aspectRatio: '9:16', generateAudio: false } })).toThrow()
  })

  it('accepts the full structural H3 duration envelope at provider preflight', () => {
    ensureAiCatalogsRegistered()
    const selection = { provider: 'comfyui' as const, modelId: COMFYUI_H3_MODEL_ID, modelKey: `comfyui::${COMFYUI_H3_MODEL_ID}`, variantSubKind: 'official' as const }
    const referenceImages = ['https://example.com/reference.png']
    expect(normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 15, aspectRatio: '9:16', generateAudio: true, referenceImages } })).toMatchObject({ duration: 15 })
    expect(() => normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { duration: 16, aspectRatio: '9:16', generateAudio: true, referenceImages } })).toThrow()
  })

  it('keeps the canonical graph wired to the final output node', () => {
    const nodes = Object.values(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow)
    expect(nodes.filter((node) => node.class_type === 'MiniMaxH3AudioConditioningT8')).toHaveLength(2)
    expect(nodes.filter((node) => node.class_type === 'ImageResizeKJv2' && node.inputs.upscale_method === 'nvidia_rtx_vsr')).toHaveLength(1)
    expect(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow[H3_DUAL_STAGE_RUNTIME_PROFILE.outputNodeId]?.class_type).toBe('VHS_VideoCombine')
    expect(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow['2']).toEqual({
      class_type: 'VAELoader',
      inputs: { vae_name: 'h3\\minimax_h3_audio_vae_fp32.safetensors' },
    })
    expect(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow['7']?.inputs.audio_vae).toEqual(['2', 0])
    expect(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow['14']?.inputs.audio_vae).toEqual(['2', 0])
    expect(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow['20']?.inputs.audio_vae).toEqual(['2', 0])
    expect(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow['168']?.inputs.audio).toEqual(['20', 1])
  })

  it('builds zero, one, and three ordered H3 reference-audio inputs and rejects a fourth', () => {
    const referenceInput = {
      prompt: 'subject_definitions:\n<Subject 1> is the person in <Picture 1>.',
      requestedDurationSeconds: 5,
      aspectRatio: '9:16',
      seed: 17,
      mode: 'reference',
      referenceImageFilenames: ['waoowaoo/prompt/reference-image-00.png'],
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

    expect(zeroAudio.graph['18']).toBeUndefined()
    expect(zeroAudio.graph['7']?.inputs['ref_audios.ref_audio_0']).toBeUndefined()
    expect(oneAudio.graph['18']).toEqual({
      class_type: 'LoadAudio',
      inputs: { audio: 'waoowaoo/prompt/reference-audio-00.mp3' },
    })
    expect(oneAudio.graph['7']?.inputs['ref_audios.ref_audio_0']).toEqual(['18', 0])
    expect(oneAudio.graph['14']?.inputs['ref_audios.ref_audio_0']).toEqual(['18', 0])
    expect(threeAudio.graph['7']?.inputs['ref_audios.ref_audio_2']).toEqual(['71', 0])
    expect(threeAudio.graph['14']?.inputs['ref_audios.ref_audio_2']).toEqual(['71', 0])
    expect(() => buildH3PromptGraph({
      ...referenceInput,
      referenceAudioFilenames: ['1.wav', '2.wav', '3.wav', '4.wav'],
    })).toThrow('COMFYUI_H3_REFERENCE_AUDIOS_COUNT_INVALID:3')
  })
})
