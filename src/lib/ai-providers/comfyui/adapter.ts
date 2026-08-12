import type { AiProviderAdapter } from '@/lib/ai-providers/runtime-types'
import { describeMediaVariantBase } from '@/lib/ai-providers/shared/media-adapter'
import { buildMediaOptionSchema, booleanValidator, enumValidator, integerRangeValidator } from '@/lib/ai-providers/shared/option-schema'
import { COMFYUI_H3_MODEL_ID } from './models'
import { executeComfyUiH3VideoGeneration } from './h3'
import { COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID } from './models'
import { executeComfyUiMossSoundGeneration } from './moss'

const H3_ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21'] as const

export const comfyuiAdapter: AiProviderAdapter = {
  providerKey: 'comfyui',
  video: {
    describe: (selection) => describeMediaVariantBase({
      modality: 'video',
      selection,
      executionMode: 'async',
      optionSchema: buildMediaOptionSchema('video', {
        allowedKeys: [],
        required: ['duration', 'resolution', 'aspectRatio', 'generateAudio'],
        excludedKeys: ['referenceImages', 'referenceAudios', 'referenceVideos', 'size', 'promptExtend', 'serviceTier', 'executionExpiresAfter', 'returnLastFrame', 'draft', 'seed', 'cameraFixed', 'watermark'],
        validators: {
          duration: integerRangeValidator({ min: 4, max: 15 }),
          resolution: enumValidator(['480p', '720p']),
          aspectRatio: enumValidator(H3_ASPECT_RATIOS),
          generateAudio: booleanValidator(),
        },
        objectValidators: [() => selection.modelId === COMFYUI_H3_MODEL_ID
          ? { ok: true }
          : { ok: false, reason: 'unsupported_model' }],
      }),
    }),
    execute: executeComfyUiH3VideoGeneration,
  },
  sound: {
    describe: (selection) => describeMediaVariantBase({
      modality: 'sound',
      selection,
      executionMode: 'async',
      optionSchema: buildMediaOptionSchema('sound', {
        allowedKeys: ['negativePrompt', 'durationSeconds', 'outputFormat'],
        required: ['durationSeconds', 'outputFormat'],
        excludedKeys: ['referenceImages', 'referenceAudios', 'referenceVideos'],
        validators: {
          durationSeconds: integerRangeValidator({ min: 1, max: 30 }),
          outputFormat: enumValidator(['mp3']),
        },
        objectValidators: [() => selection.modelId === COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID
          ? { ok: true }
          : { ok: false, reason: 'unsupported_model' }],
      }),
    }),
    execute: executeComfyUiMossSoundGeneration,
  },
}
