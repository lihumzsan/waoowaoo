import type { AiProviderAdapter } from '@/lib/ai-providers/runtime-types'
import { describeMediaVariantBase } from '@/lib/ai-providers/shared/media-adapter'
import { buildMediaOptionSchema, booleanValidator, enumValidator, integerRangeValidator, nonEmptyStringValidator, stringArrayValidator } from '@/lib/ai-providers/shared/option-schema'
import { describeComfyUiMusic } from './music-profiles'
import { prepareComfyUiMusicGeneration } from './music-runtime'
import {
  COMFYUI_H3_MODEL_ID,
} from './models'
import { prepareComfyUiH3VideoGeneration } from './h3'
import {
  H3_MAX_REFERENCE_AUDIOS,
  H3_MAX_REFERENCE_IMAGES,
} from './profiles'
import {
  H3_DURATION_OPTIONS_SECONDS,
} from '@/lib/video-generation/h3-duration'
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
        allowedKeys: ['referenceImages', 'referenceAudios', 'lastFrameImageUrl', 'continuationVideoUrl'],
        required: ['duration', 'aspectRatio', 'generateAudio'],
        excludedKeys: ['resolution', 'referenceVideos', 'size', 'promptExtend', 'serviceTier', 'executionExpiresAfter', 'returnLastFrame', 'draft', 'seed', 'cameraFixed', 'watermark'],
        validators: {
          duration: integerRangeValidator({
            min: Math.min(...H3_DURATION_OPTIONS_SECONDS),
            max: Math.max(...H3_DURATION_OPTIONS_SECONDS),
          }),
          aspectRatio: enumValidator(H3_ASPECT_RATIOS),
          generateAudio: booleanValidator(),
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
