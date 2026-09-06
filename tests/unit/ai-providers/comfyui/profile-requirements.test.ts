import { describe, expect, it } from 'vitest'
import { deriveComfyUiProfileRequirements } from '@/lib/ai-providers/comfyui/profile-requirements'
import type { ComfyUiPromptGraph } from '@/lib/ai-providers/comfyui/profiles'

describe('deriveComfyUiProfileRequirements', () => {
  it('derives unique node classes and exact option values from the selected graph', () => {
    const graph: ComfyUiPromptGraph = {
      '2': {
        class_type: 'ImageResizeKJv2',
        inputs: {
          image: ['1', 0],
          upscale_method: 'nvidia_rtx_vsr',
          width: 1920,
        },
      },
      '1': {
        class_type: 'UNETLoader',
        inputs: {
          unet_name: 'h3\\frame.safetensors',
          weight_dtype: 'default',
        },
      },
      '3': {
        class_type: 'UNETLoader',
        inputs: {
          unet_name: 'h3\\second.safetensors',
          weight_dtype: 'default',
        },
      },
      '4': {
        class_type: 'LoraLoaderBypassModelOnly',
        inputs: {
          model: ['3', 0],
          lora_name: 'h3\\bypass.safetensors',
          strength_model: 0.9,
        },
      },
      '5': {
        class_type: 'MiniMaxH3LearnedLatentUpscaleT8Advanced',
        inputs: {
          av_latent: ['4', 0],
          model_name: 'minimax_h3_latent_upscaler_3d_fp16.safetensors',
          size_mode: 'target_megapixels',
          aspect_policy: 'preserve_source',
          precision: 'fp16',
          release_policy: 'offload_after',
        },
      },
    }

    expect(deriveComfyUiProfileRequirements({
      profileId: 'frame-profile',
      graph,
    })).toMatchObject({
      nodeClasses: [
        'ImageResizeKJv2',
        'LoraLoaderBypassModelOnly',
        'MiniMaxH3LearnedLatentUpscaleT8Advanced',
        'UNETLoader',
      ],
      options: [
        {
          classType: 'ImageResizeKJv2',
          inputName: 'upscale_method',
          value: 'nvidia_rtx_vsr',
        },
        {
          classType: 'LoraLoaderBypassModelOnly',
          inputName: 'lora_name',
          value: 'h3\\bypass.safetensors',
        },
        {
          classType: 'MiniMaxH3LearnedLatentUpscaleT8Advanced',
          inputName: 'aspect_policy',
          value: 'preserve_source',
        },
        {
          classType: 'MiniMaxH3LearnedLatentUpscaleT8Advanced',
          inputName: 'model_name',
          value: 'minimax_h3_latent_upscaler_3d_fp16.safetensors',
        },
        {
          classType: 'MiniMaxH3LearnedLatentUpscaleT8Advanced',
          inputName: 'precision',
          value: 'fp16',
        },
        {
          classType: 'MiniMaxH3LearnedLatentUpscaleT8Advanced',
          inputName: 'release_policy',
          value: 'offload_after',
        },
        {
          classType: 'MiniMaxH3LearnedLatentUpscaleT8Advanced',
          inputName: 'size_mode',
          value: 'target_megapixels',
        },
        {
          classType: 'UNETLoader',
          inputName: 'unet_name',
          value: 'h3\\frame.safetensors',
        },
        {
          classType: 'UNETLoader',
          inputName: 'unet_name',
          value: 'h3\\second.safetensors',
        },
      ],
    })
  })

  it('uses canonical graph content and profile id for the fingerprint', () => {
    const first: ComfyUiPromptGraph = {
      '2': { class_type: 'BasicScheduler', inputs: { steps: 3, scheduler: 'beta' } },
      '1': { class_type: 'UNETLoader', inputs: { weight_dtype: 'default', unet_name: 'model-a' } },
    }
    const reordered: ComfyUiPromptGraph = {
      '1': { inputs: { unet_name: 'model-a', weight_dtype: 'default' }, class_type: 'UNETLoader' },
      '2': { inputs: { scheduler: 'beta', steps: 3 }, class_type: 'BasicScheduler' },
    }
    const changed: ComfyUiPromptGraph = {
      ...reordered,
      '1': { ...reordered['1']!, inputs: { ...reordered['1']!.inputs, unet_name: 'model-b' } },
    }

    const firstRequirements = deriveComfyUiProfileRequirements({
      profileId: 'reference-profile',
      graph: first,
    })
    expect(deriveComfyUiProfileRequirements({
      profileId: 'reference-profile',
      graph: reordered,
    }).fingerprint).toBe(firstRequirements.fingerprint)
    expect(deriveComfyUiProfileRequirements({
      profileId: 'reference-profile',
      graph: changed,
    }).fingerprint).not.toBe(firstRequirements.fingerprint)
    expect(deriveComfyUiProfileRequirements({
      profileId: 'frame-profile',
      graph: first,
    }).fingerprint).not.toBe(firstRequirements.fingerprint)
  })
})
