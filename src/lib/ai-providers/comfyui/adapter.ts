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
import { executeComfyUiH3VideoGeneration } from './h3'
import {
  H3_MAX_REFERENCE_IMAGES,
} from './profiles'
import {
  H3_DURATION_MAX_SECONDS,
  H3_DURATION_MIN_SECONDS,
} from '@/lib/video-generation/h3-duration'
import { COMFYUI_MOSS_SOUNDEFFECT_V2_MODEL_ID } from './models'
import { executeComfyUiMossSoundGeneration } from './moss'
import { executeComfyUiMossTtsGeneration } from './tts'
import { createAiProviderFailureAdapter } from '@/lib/ai-providers/failure'

const H3_ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21'] as const

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
        allowedKeys: ['referenceImages', 'lastFrameImageUrl', 'continuationVideoUrl'],
        required: ['duration', 'aspectRatio', 'generateAudio'],
        excludedKeys: ['resolution', 'referenceAudios', 'referenceVideos', 'size', 'promptExtend', 'serviceTier', 'executionExpiresAfter', 'returnLastFrame', 'draft', 'seed', 'cameraFixed', 'watermark'],
        validators: {
          duration: integerRangeValidator({
            min: H3_DURATION_MIN_SECONDS,
            max: H3_DURATION_MAX_SECONDS,
          }),
          aspectRatio: enumValidator(H3_ASPECT_RATIOS),
          generateAudio: booleanValidator(),
          referenceImages: stringArrayValidator({ maxLength: H3_MAX_REFERENCE_IMAGES }),
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
  voice: {
    describe: (selection) => describeMediaVariantBase({
      modality: 'voice',
      selection,
      executionMode: 'async',
      optionSchema: buildMediaOptionSchema('voice', {
        allowedKeys: ['language', 'referenceAudio', 'referenceAudioDurationMs', 'outputFormat'],
        required: ['language', 'referenceAudio', 'referenceAudioDurationMs', 'outputFormat'],
        excludedKeys: ['referenceImages', 'referenceVideos'],
        validators: {
          language: enumValidator(['auto', 'zh', 'en', 'ja', 'ko']),
          referenceAudio: (value) => typeof value === 'string' && value.trim().length > 0
            ? { ok: true }
            : { ok: false, reason: 'reference_audio_required' },
          referenceAudioDurationMs: integerRangeValidator({ min: 3000, max: 10000 }),
          outputFormat: enumValidator(['mp3']),
        },
        objectValidators: [() => selection.modelKey === 'comfyui::moss-tts-local-1.7b'
          ? { ok: true }
          : { ok: false, reason: 'unsupported_model' }],
      }),
    }),
    execute: executeComfyUiMossTtsGeneration,
  },
}
