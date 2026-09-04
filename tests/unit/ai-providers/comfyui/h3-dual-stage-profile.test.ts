import { describe, expect, it } from 'vitest'
import {
  H3_ASPECT_RATIOS,
  H3_DUAL_STAGE_RUNTIME_PROFILE,
  buildH3PromptGraph,
  resolveH3Dimensions,
  resolveH3DurationFrames,
  resolveH3EffectiveDurationSeconds,
} from '@/lib/ai-providers/comfyui/profiles'

describe('MiniMax H3 dual-stage profile', () => {
  it('keeps the provider frame grid and derives the delivery canvas from one aspect ratio', () => {
    expect(resolveH3DurationFrames(4)).toBe(107)
    expect(resolveH3DurationFrames(5)).toBe(124)
    expect(resolveH3DurationFrames(10)).toBe(243)
    expect(resolveH3DurationFrames(13)).toBe(328)
    expect(resolveH3EffectiveDurationSeconds(4)).toBe(107 / 24)
    expect(resolveH3EffectiveDurationSeconds(13)).toBe(328 / 24)
    expect(resolveH3Dimensions({ megapixels: 1, aspectRatio: '16:9' })).toEqual({ width: 1376, height: 768 })
    expect(resolveH3Dimensions({ megapixels: 2, aspectRatio: '16:9' })).toEqual({ width: 2064, height: 1152 })
  })

  it.each([
    ['21:9', 1568, 672, 2352, 1008],
    ['16:9', 1376, 768, 2064, 1152],
    ['4:3', 1184, 896, 1776, 1344],
    ['1:1', 1024, 1024, 1536, 1536],
    ['3:4', 896, 1184, 1344, 1776],
    ['9:16', 768, 1376, 1152, 2064],
    ['9:21', 672, 1568, 1008, 2352],
  ] as const)('preserves the exact %s generation ratio at the delivery canvas', (
    aspectRatio,
    generationWidth,
    generationHeight,
    deliveryWidth,
    deliveryHeight,
  ) => {
    expect(H3_ASPECT_RATIOS).toContain(aspectRatio)
    const generation = resolveH3Dimensions({ megapixels: 1, aspectRatio })
    const delivery = resolveH3Dimensions({ megapixels: 2, aspectRatio })
    expect(generation).toEqual({ width: generationWidth, height: generationHeight })
    expect(delivery).toEqual({ width: deliveryWidth, height: deliveryHeight })
    expect(generation.width * delivery.height).toBe(generation.height * delivery.width)
    expect(delivery.width % 16).toBe(0)
    expect(delivery.height % 16).toBe(0)
  })

  it('rounds a nine-second request up to the next valid H3 frame grid value', () => {
    expect(resolveH3DurationFrames(9)).toBe(226)
  })

  it('rejects H3 graph durations above thirteen seconds', () => {
    expect(() => resolveH3DurationFrames(14)).toThrow('COMFYUI_H3_OPTION_UNSUPPORTED:duration=14')
    expect(() => resolveH3DurationFrames(15)).toThrow('COMFYUI_H3_OPTION_UNSUPPORTED:duration=15')
  })

  it('contains both VSR stages, both cache clears, and no Codex or LoadImage node', () => {
    const nodes = Object.values(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow)
    expect(nodes.some((node) => node.class_type === 'RH_CODEX_NODE')).toBe(false)
    expect(nodes.some((node) => node.class_type === 'LoadImage')).toBe(false)
    expect(nodes.filter((node) => node.class_type === 'easy clearCacheAll')).toHaveLength(2)
    expect(nodes.filter((node) => node.class_type === 'ImageResizeKJv2' && node.inputs.upscale_method === 'nvidia_rtx_vsr')).toHaveLength(2)
    expect(nodes.find((node) => node.class_type === 'MiniMaxH3ReferenceToVideo')).toBeTruthy()
  })

  it('binds ordered reference URLs, prompt, one-stage length, and both output sizes without mutating the profile', () => {
    const first = buildH3PromptGraph({
      mode: 'reference',
      prompt: 'subject_definitions:\nSubject 1 is in Picture 1.',
      referenceImageUrls: ['https://example.test/reference-1.png', 'https://example.test/reference-2.png'],
      durationSeconds: 4,
      aspectRatio: '16:9',
      seed: 7,
    })
    const second = buildH3PromptGraph({
      mode: 'reference',
      prompt: 'subject_definitions:\nSubject 1 is in Picture 1.',
      referenceImageUrls: ['https://example.test/reference-3.png'],
      durationSeconds: 13,
      aspectRatio: '9:16',
      seed: 8,
    })
    expect(first.profile.referenceImageNodeIds).toHaveLength(8)
    expect(first.graph[first.profile.referenceImageNodeIds[0]!]!.inputs.url).toBe('https://example.test/reference-1.png')
    expect(first.graph[first.profile.referenceImageNodeIds[1]!]!.inputs.url).toBe('https://example.test/reference-2.png')
    expect(first.graph[first.profile.h3NodeId]?.inputs['ref_images.ref_image_0']).toEqual([first.profile.referenceResizeNodeIds[0], 0])
    expect(first.graph[first.profile.h3NodeId]?.inputs['ref_images.ref_image_1']).toEqual([first.profile.referenceResizeNodeIds[1], 0])
    expect(first.graph[first.profile.h3NodeId]?.inputs['ref_images.ref_image_2']).toBeUndefined()
    expect(first.graph[first.profile.promptNodeId]?.inputs.value).toContain('subject_definitions')
    expect(first.graph[first.profile.h3NodeId]?.inputs.length).toBe(107)
    expect(first.graph[first.profile.firstUpscaleNodeId]?.inputs.width).toBe(1376)
    expect(first.graph[first.profile.finalUpscaleNodeId]?.inputs.height).toBe(1152)
    expect(second.graph[second.profile.h3NodeId]?.inputs.length).toBe(328)
    expect(second.graph[second.profile.firstUpscaleNodeId]?.inputs.width).toBe(768)
    expect(second.graph[second.profile.finalUpscaleNodeId]?.inputs.height).toBe(2064)
    expect(second.graph[second.profile.h3NodeId]?.inputs['ref_images.ref_image_1']).toBeUndefined()
    expect(H3_DUAL_STAGE_RUNTIME_PROFILE.workflow[H3_DUAL_STAGE_RUNTIME_PROFILE.h3NodeId]?.inputs.length).toBe(124)
  })
})
