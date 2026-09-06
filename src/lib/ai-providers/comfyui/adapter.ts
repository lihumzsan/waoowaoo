import type { AiProviderAdapter } from '@/lib/ai-providers/runtime-types'
import { describeMediaVariantBase } from '@/lib/ai-providers/shared/media-adapter'
import { buildMediaOptionSchema, booleanValidator, enumValidator, integerRangeValidator, nonEmptyStringValidator, stringArrayValidator } from '@/lib/ai-providers/shared/option-schema'
import { ACE_STEP_MIN_PROVIDER_DURATION_SECONDS, executeComfyUiAceStepMusicGeneration } from './ace-step'
import {
  COMFYUI_ACE_STEP_1_5_MODEL_ID,
  COMFYUI_ACE_STEP_KEY_SCALE_OPTIONS,
  COMFYUI_ACE_STEP_TIME_SIGNATURE_OPTIONS,
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
    describe: (selection) => describeMediaVariantBase({
      modality: 'music',
      selection,
      executionMode: 'async',
      optionSchema: buildMediaOptionSchema('music', {
        allowedKeys: ['keyScale', 'timeSignature', 'providerDurationSeconds'],
        required: ['durationSeconds', 'vocalMode', 'bpm', 'keyScale', 'timeSignature', 'outputFormat'],
        excludedKeys: ['negativePrompt', 'genre', 'mood', 'referenceVideos'],
        validators: {
          durationSeconds: integerRangeValidator({ min: 4, max: 600 }),
          vocalMode: enumValidator(['instrumental']),
          bpm: integerRangeValidator({ min: 20, max: 300 }),
          keyScale: enumValidator(COMFYUI_ACE_STEP_KEY_SCALE_OPTIONS),
          timeSignature: enumValidator(COMFYUI_ACE_STEP_TIME_SIGNATURE_OPTIONS),
          outputFormat: enumValidator(['mp3']),
        },
        objectValidators: [() => selection.modelId === COMFYUI_ACE_STEP_1_5_MODEL_ID
          ? { ok: true }
          : { ok: false, reason: 'unsupported_model' }],
        normalize: (options) => ({
          ...options,
          providerDurationSeconds: Math.max(
            options.durationSeconds as number,
            ACE_STEP_MIN_PROVIDER_DURATION_SECONDS,
          ),
        }),
      }),
    }),
    execute: executeComfyUiAceStepMusicGeneration,
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
