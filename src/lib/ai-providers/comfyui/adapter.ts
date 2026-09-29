import type { AiProviderAdapter } from '@/lib/ai-providers/runtime-types'
import { describeMediaVariantBase } from '@/lib/ai-providers/shared/media-adapter'
import { buildMediaOptionSchema, booleanValidator, enumValidator, integerOptionsValidator, nonEmptyStringValidator, stringArrayValidator } from '@/lib/ai-providers/shared/option-schema'
import { describeComfyUiMusic } from './music-profiles'
import { prepareComfyUiMusicGeneration } from './music-runtime'
import {
  COMFYUI_H3_MODEL_ID,
  COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES,
} from './models'
import { prepareComfyUiH3VideoGeneration } from './h3'
import {
  H3_MAX_REFERENCE_AUDIOS,
  H3_MAX_REFERENCE_IMAGES,
} from './profiles'
import { listH3DurationOptions } from '@/lib/video-generation/h3-runtime-policy'
import { H3_ASPECT_RATIOS } from '@/lib/video-generation/h3-reference-runtime-plan'
import { createAiProviderFailureAdapter } from '@/lib/ai-providers/failure'

export const comfyuiAdapter: AiProviderAdapter = {
  providerKey: 'comfyui',
  failure: createAiProviderFailureAdapter('comfyui'),
  music: {
    describe: describeComfyUiMusic,
    prepare: prepareComfyUiMusicGeneration,
  },
  video: {
    describe: (selection) => describeMediaVariantBase({
      modality: 'video',
      selection,
      executionMode: 'async',
      optionSchema: buildMediaOptionSchema('video', {
        allowedKeys: ['referenceImages', 'referenceAudios', 'referenceVideoUpscale', 'lastFrameImageUrl', 'continuationVideoUrl'],
        required: ['duration', 'aspectRatio', 'generateAudio'],
        excludedKeys: ['resolution', 'referenceVideos', 'size', 'promptExtend', 'serviceTier', 'executionExpiresAfter', 'returnLastFrame', 'draft', 'seed', 'cameraFixed', 'watermark'],
        validators: {
          duration: integerOptionsValidator(COMFYUI_BUILTIN_CAPABILITY_CATALOG_ENTRIES
            .filter((entry) => entry.modelType === 'video' && entry.modelId === COMFYUI_H3_MODEL_ID)
            .flatMap((entry) => entry.capabilities.video.supportedInputModes ?? [])
            .flatMap((mode) => listH3DurationOptions(mode))),
          aspectRatio: enumValidator(H3_ASPECT_RATIOS),
          generateAudio: booleanValidator(),
          referenceVideoUpscale: booleanValidator(),
          referenceImages: stringArrayValidator({ maxLength: H3_MAX_REFERENCE_IMAGES }),
          referenceAudios: stringArrayValidator({ maxLength: H3_MAX_REFERENCE_AUDIOS }),
          lastFrameImageUrl: nonEmptyStringValidator(),
          continuationVideoUrl: nonEmptyStringValidator(),
        },
        objectValidators: [() => selection.modelId === COMFYUI_H3_MODEL_ID
          ? { ok: true }
          : { ok: false, reason: 'unsupported_model' },
        (options) => options.generateAudio === true
          ? { ok: true }
          : { ok: false, reason: 'generate_audio_required' }],
      }),
    }),
    prepare: prepareComfyUiH3VideoGeneration,
  },
}
