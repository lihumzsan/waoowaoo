import { describe, expect, it } from 'vitest'
import {
  H3_DUAL_STAGE_RUNTIME_PROFILE,
  buildH3PromptGraph,
  resolveH3Dimensions,
} from '@/lib/ai-providers/comfyui/profiles'

const prompt = 'subject_definitions:\n<Subject 1> is represented by <Picture 1>.'

describe('MiniMax H3 Ref dual-stage profile', () => {
  it.each([
    { duration: 4, frameCount: 107, aspectRatio: '16:9' as const },
    { duration: 5, frameCount: 124, aspectRatio: '9:16' as const },
    { duration: 10, frameCount: 243, aspectRatio: '21:9' as const },
    { duration: 11, frameCount: 277, aspectRatio: '9:21' as const },
  ])('injects the legacy reference graph for $duration seconds at $aspectRatio', ({
    duration,
    frameCount,
    aspectRatio,
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
    const first = resolveH3Dimensions({ megapixels: 1, aspectRatio })
    const final = resolveH3Dimensions({ megapixels: 2, aspectRatio })
    expect(built.graph[built.profile.h3NodeId]?.inputs).toMatchObject({
      prompt: [built.profile.promptNodeId, 0],
      width: first.width,
      height: first.height,
      length: frameCount,
    })
    expect(built.graph[built.profile.firstUpscaleNodeId]?.inputs).toMatchObject(first)
    expect(built.graph[built.profile.finalUpscaleNodeId]?.inputs).toMatchObject(final)
    expect(built.graph[built.profile.noiseNodeId]?.inputs.noise_seed).toBe(7)
  })

  it('binds ordered local image and audio inputs without mutating the template', () => {
    const imageFilenames = Array.from(
      { length: 8 },
      (_, index) => `waoowaoo/prompt/reference-image-${String(index).padStart(2, '0')}.png`,
    )
    const audioFilenames = [
      'waoowaoo/prompt/reference-audio-00.mp3',
      'waoowaoo/prompt/reference-audio-01.wav',
    ]
    const built = buildH3PromptGraph({
      mode: 'reference',
      prompt,
      referenceImageFilenames: imageFilenames,
      referenceAudioFilenames: audioFilenames,
      requestedDurationSeconds: 11,
      aspectRatio: '16:9',
      seed: 8,
    })
    for (const [index, filename] of imageFilenames.entries()) {
      const loadNodeId = built.profile.referenceImageNodeIds[index]!
      const resizeNodeId = built.profile.referenceResizeNodeIds[index]!
      expect(built.graph[loadNodeId]).toEqual({
        class_type: 'LoadImage',
        inputs: { image: filename },
      })
      expect(built.graph[resizeNodeId]?.inputs.image).toEqual([loadNodeId, 0])
      expect(built.graph[built.profile.h3NodeId]?.inputs[`ref_images.ref_image_${String(index)}`]).toEqual([resizeNodeId, 0])
    }
    for (const [index, filename] of audioFilenames.entries()) {
      const nodeId = built.profile.referenceAudioNodeIds[index]!
      expect(built.graph[nodeId]).toEqual({ class_type: 'LoadAudio', inputs: { audio: filename } })
      expect(built.graph[built.profile.h3NodeId]?.inputs[`ref_audios.ref_audio_${String(index)}`]).toEqual([nodeId, 0])
    }
    expect(built.graph[built.profile.promptNodeId]?.inputs.value).toBe(prompt)
    expect(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow['137']?.inputs.image).toBe('reference-image-00.png')
    expect(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow['340']?.inputs.audio).toBe('waoowaoo/template/reference-audio-00.mp3')
  })

  it('rejects reference counts and durations outside the restored boundary', () => {
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
      requestedDurationSeconds: 12,
    })).toThrow('H3_REQUESTED_DURATION_INVALID:reference:12')
  })
})
