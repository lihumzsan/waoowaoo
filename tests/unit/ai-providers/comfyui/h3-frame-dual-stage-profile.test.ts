import { describe, expect, it } from 'vitest'
import {
  H3_FRAME_DUAL_STAGE_RUNTIME_PROFILE,
  buildH3PromptGraph,
} from '@/lib/ai-providers/comfyui/profiles'
import { resolveH3DurationPlan } from '@/lib/video-generation/h3-duration'

const commonInput = {
  prompt: 'subject_definitions:\nSubject 1 is represented by Picture 1.',
  frameCount: resolveH3DurationPlan(4).frameCount,
  aspectRatio: '16:9' as const,
  seed: 17,
}

describe('MiniMax H3 frame dual-stage profile', () => {
  it('uses one frame profile for first-frame and first-last-frame inputs', () => {
    const firstFrame = buildH3PromptGraph({
      ...commonInput,
      mode: 'first_frame',
      firstFrameUrl: 'https://example.test/first.png',
    })
    const firstLastFrame = buildH3PromptGraph({
      ...commonInput,
      mode: 'first_last_frame',
      firstFrameUrl: 'https://example.test/first.png',
      lastFrameUrl: 'https://example.test/last.png',
    })

    expect(firstFrame.profile.id).toBe('h3-frame-dual-stage-2mp')
    expect(firstLastFrame.profile).toBe(firstFrame.profile)
    expect(firstFrame.graph['137']?.inputs.url).toBe('https://example.test/first.png')
    expect(firstFrame.graph['198']).toEqual({
      class_type: 'ImageResizeKJv2',
      inputs: {
        image: ['137', 0],
        width: 1376,
        height: 768,
        upscale_method: 'lanczos',
        keep_proportion: 'crop',
        pad_color: '0, 0, 0',
        crop_position: 'center',
        divisible_by: 32,
        device: 'cpu',
      },
    })
    expect(firstFrame.graph['309']?.inputs.first_frame).toEqual(['198', 0])
    expect(firstFrame.graph['309']?.inputs.last_frame).toBeUndefined()
    expect(firstFrame.graph['326']).toBeUndefined()
    expect(firstFrame.graph['327']).toBeUndefined()

    expect(firstLastFrame.graph['326']?.inputs.url).toBe('https://example.test/last.png')
    expect(firstLastFrame.graph['327']).toEqual({
      class_type: 'ImageResizeKJv2',
      inputs: {
        image: ['326', 0],
        width: 1376,
        height: 768,
        upscale_method: 'lanczos',
        keep_proportion: 'crop',
        pad_color: '0, 0, 0',
        crop_position: 'center',
        divisible_by: 32,
        device: 'cpu',
      },
    })
    expect(firstLastFrame.graph['309']?.inputs.last_frame).toEqual(['327', 0])
  })

  it('preserves the source models, sampling stages, VSR handoff, native audio, and final output', () => {
    const built = buildH3PromptGraph({
      ...commonInput,
      mode: 'first_last_frame',
      firstFrameUrl: 'https://example.test/first.png',
      lastFrameUrl: 'https://example.test/last.png',
    })
    const graph = built.graph

    expect(graph['127']?.inputs.unet_name).toBe('h3\\minimax_h3_fl2va_int8_convrot.safetensors')
    expect(graph['306']?.inputs.unet_name).toBe('h3\\minimax_h3_fl2va_pruned_int8_convrot.safetensors')
    expect(graph['309']?.class_type).toBe('MiniMaxH3ImageToVideo')
    expect(graph['124']?.inputs).toMatchObject({ scheduler: 'beta', steps: 10, denoise: 1 })
    expect(graph['223']?.inputs).toMatchObject({ scheduler: 'beta', steps: 3, denoise: 0.2 })
    expect(graph['123']?.inputs.sampler_name).toBe('euler')
    expect(graph['224']?.inputs.sampler_name).toBe('res_multistep')
    expect(graph['213']?.inputs).toMatchObject({
      width: 1376,
      height: 768,
      upscale_method: 'nvidia_rtx_vsr',
    })
    expect(graph['325']?.inputs).toMatchObject({
      width: 2064,
      height: 1152,
      upscale_method: 'nvidia_rtx_vsr',
    })
    expect(Object.values(graph).filter((node) => node.class_type === 'EasyCache')).toHaveLength(2)
    expect(Object.values(graph).filter((node) => node.class_type === 'easy clearCacheAll')).toHaveLength(2)
    expect(graph['168']).toMatchObject({
      class_type: 'VHS_VideoCombine',
      inputs: {
        images: ['325', 0],
        audio: ['121', 0],
        frame_rate: 24,
        format: 'video/h264-mp4',
        pix_fmt: 'yuv420p',
        crf: 10,
        save_output: true,
      },
    })
  })

  it('contains no desktop image, Codex, preview, or canvas-only nodes', () => {
    const classes = Object.values(H3_FRAME_DUAL_STAGE_RUNTIME_PROFILE.workflow)
      .map((node) => node.class_type)
    expect(classes).not.toContain('LoadImage')
    expect(classes).not.toContain('RH_CODEX_NODE')
    expect(classes).not.toContain('easy showAnything')
    expect(classes).not.toContain('SetNode')
    expect(classes).not.toContain('GetNode')
    expect(classes).toContain('Load Image From Url (mtb)')
    expect(JSON.stringify(H3_FRAME_DUAL_STAGE_RUNTIME_PROFILE.workflow)).not.toContain('D:\\workspace')
    expect(JSON.stringify(H3_FRAME_DUAL_STAGE_RUNTIME_PROFILE.workflow)).not.toContain('cos_url')
  })

  it('does not mutate the frozen frame profile between builds', () => {
    buildH3PromptGraph({
      ...commonInput,
      mode: 'first_last_frame',
      firstFrameUrl: 'https://example.test/first.png',
      lastFrameUrl: 'https://example.test/last.png',
    })
    expect(H3_FRAME_DUAL_STAGE_RUNTIME_PROFILE.workflow['137']?.inputs.url).toBe('')
    expect(H3_FRAME_DUAL_STAGE_RUNTIME_PROFILE.workflow['326']?.inputs.url).toBe('')
    expect(H3_FRAME_DUAL_STAGE_RUNTIME_PROFILE.workflow['309']?.inputs.last_frame).toEqual(['327', 0])
  })
})
