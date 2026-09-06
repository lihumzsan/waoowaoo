import { describe, expect, it } from 'vitest'
import {
  H3_DUAL_STAGE_RUNTIME_PROFILE,
  buildH3PromptGraph,
} from '@/lib/ai-providers/comfyui/profiles'

const prompt = 'subject_definitions:\n<Subject 1> is represented by <Picture 1>.'

describe('MiniMax H3 Ref T8 dual-stage profile', () => {
  it('contains the sanitized validated T8 4+5 graph and H.264 delivery contract', () => {
    const nodes = Object.values(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow)
    expect(nodes.filter((node) => node.class_type === 'MiniMaxH3AudioConditioningT8')).toHaveLength(2)
    expect(nodes.some((node) => node.class_type === 'MiniMaxH3DualClockSamplerT8')).toBe(true)
    expect(nodes.some((node) => node.class_type === 'MiniMaxH3LearnedTwoPassParityPlanT8Advanced')).toBe(true)
    expect(nodes.some((node) => node.class_type === 'MiniMaxH3LearnedLatentUpscaleT8Advanced')).toBe(true)
    expect(nodes.some((node) => node.class_type === 'MiniMaxH3TwoPassLatentReconcileT8Advanced')).toBe(true)
    expect(nodes.some((node) => node.class_type === 'MiniMaxH3TwoPassDetailMixerT8Advanced')).toBe(true)
    expect(nodes.some((node) => node.class_type === 'MiniMaxH3AVDecodeT8')).toBe(true)
    expect(nodes.some((node) => node.class_type === 'ResolutionSelector')).toBe(false)
    expect(nodes.some((node) => node.class_type === 'ComfyMathExpression')).toBe(false)
    expect(nodes.some((node) => node.class_type === 'MiniMaxH3ReferenceToVideo')).toBe(false)
    expect(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow['9']?.inputs).toMatchObject({
      base_steps: 9,
      coarse_steps: 4,
      refine_steps: 5,
    })
    expect(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow['168']?.inputs).toMatchObject({
      format: 'video/h264-mp4',
      pix_fmt: 'yuv420p',
      crf: 10,
      frame_rate: 24,
      images: ['55', 0],
      audio: ['20', 1],
    })
  })

  it.each([
    {
      duration: 5,
      aspectRatio: '9:16' as const,
      first: { width: 640, height: 1152 },
      secondMegapixels: 1,
      final: { width: 1088, height: 1920 },
    },
    {
      duration: 10,
      aspectRatio: '21:9' as const,
      first: { width: 1312, height: 576 },
      secondMegapixels: 1,
      final: { width: 2208, height: 960 },
    },
    {
      duration: 15,
      aspectRatio: '9:21' as const,
      first: { width: 448, height: 1088 },
      secondMegapixels: 0.67,
      final: { width: 960, height: 2208 },
    },
  ])('injects the mandatory MP stages for $duration seconds at $aspectRatio', ({
    duration,
    aspectRatio,
    first,
    secondMegapixels,
    final,
  }) => {
    const built = buildH3PromptGraph({
      mode: 'reference',
      prompt,
      referenceImageFilenames: ['waoowaoo/prompt/reference-image-00.png'],
      referenceAudioFilenames: [],
      requestedDurationSeconds: duration,
      aspectRatio,
      seed: 7,
    })
    const [coarseId, refineId] = built.profile.conditioningNodeIds
    const frameCount = duration === 5 ? 124 : duration === 10 ? 243 : 362
    expect(built.graph[coarseId]?.inputs).toMatchObject({
      prompt: [built.profile.promptNodeId, 0],
      width: first.width,
      height: first.height,
      length: frameCount,
    })
    expect(built.graph[refineId]?.inputs).toMatchObject({
      prompt: [built.profile.promptNodeId, 0],
      width: [built.profile.learnedUpscaleNodeId, 1],
      height: [built.profile.learnedUpscaleNodeId, 2],
      length: frameCount,
    })
    expect(built.graph[built.profile.learnedUpscaleNodeId]?.inputs.target_megapixels).toBe(secondMegapixels)
    expect(built.graph[built.profile.finalUpscaleNodeId]?.inputs).toMatchObject(final)
    expect(built.graph[built.profile.noiseNodeId]?.inputs.noise_seed).toBe(7)
  })

  it('binds ordered image and audio loaders to both conditioning passes without mutating the template', () => {
    const imageFilenames = [
      'waoowaoo/prompt/reference-image-00.png',
      'waoowaoo/prompt/reference-image-01.webp',
    ]
    const audioFilenames = [
      'waoowaoo/prompt/reference-audio-00.mp3',
      'waoowaoo/prompt/reference-audio-01.wav',
    ]
    const built = buildH3PromptGraph({
      mode: 'reference',
      prompt,
      referenceImageFilenames: imageFilenames,
      referenceAudioFilenames: audioFilenames,
      requestedDurationSeconds: 15,
      aspectRatio: '16:9',
      seed: 8,
    })
    for (const [index, filename] of imageFilenames.entries()) {
      const nodeId = built.profile.referenceImageNodeIds[index]!
      expect(built.graph[nodeId]).toEqual({ class_type: 'LoadImage', inputs: { image: filename } })
      for (const conditioningId of built.profile.conditioningNodeIds) {
        expect(built.graph[conditioningId]?.inputs[`ref_images.ref_image_${String(index)}`]).toEqual([nodeId, 0])
      }
    }
    for (const [index, filename] of audioFilenames.entries()) {
      const nodeId = built.profile.referenceAudioNodeIds[index]!
      expect(built.graph[nodeId]).toEqual({ class_type: 'LoadAudio', inputs: { audio: filename } })
      for (const conditioningId of built.profile.conditioningNodeIds) {
        expect(built.graph[conditioningId]?.inputs[`ref_audios.ref_audio_${String(index)}`]).toEqual([nodeId, 0])
      }
    }
    expect(built.graph[built.profile.promptNodeId]?.inputs.prompt).toBe(prompt)
    expect(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow['6']?.inputs.image).toBe('reference-image-00.png')
    expect(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow['18']?.inputs.audio).toBe('reference-audio-00.mp3')
  })

  it('rejects reference counts and durations outside the declared Ref boundary', () => {
    const common = {
      mode: 'reference' as const,
      prompt,
      referenceAudioFilenames: [],
      aspectRatio: '16:9' as const,
      seed: 9,
    }
    expect(() => buildH3PromptGraph({
      ...common,
      referenceImageFilenames: [],
      requestedDurationSeconds: 5,
    })).toThrow('COMFYUI_H3_REFERENCE_IMAGES_COUNT_INVALID:8')
    expect(() => buildH3PromptGraph({
      ...common,
      referenceImageFilenames: Array.from({ length: 9 }, (_, index) => `${String(index)}.png`),
      requestedDurationSeconds: 5,
    })).toThrow('COMFYUI_H3_REFERENCE_IMAGES_COUNT_INVALID:8')
    expect(() => buildH3PromptGraph({
      ...common,
      referenceImageFilenames: ['one.png'],
      requestedDurationSeconds: 4,
    })).toThrow('H3_REQUESTED_DURATION_INVALID:reference:4')
  })
})
