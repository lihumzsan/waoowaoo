import { z } from 'zod'
import { taskRuntimePayloadEnvelopeShape } from '@/lib/task/progress-payload'
import {
  workspaceResourceLifecycleProjectionSchema,
} from './task-runtime-envelope'
import { workspaceResourceGenerationOptionsSchema } from './generation-contract'

export const VIDEO_MERGE_AUDIO_MODES = ['preserve', 'mix', 'replace', 'mute'] as const
export const videoMergeAudioModeSchema = z.enum(VIDEO_MERGE_AUDIO_MODES)
export type VideoMergeAudioMode = z.infer<typeof videoMergeAudioModeSchema>

export const videoMergeGenerationOptionsSchema = z.object({
  mergeMode: z.literal('ordered_concat'),
  audioMode: videoMergeAudioModeSchema,
}).strict()

export const videoMergeTimedCueGenerationOptionsSchema = z.object({
  mergeMode: z.literal('timed_cues'),
  audioMode: z.literal('preserve'),
}).strict()

export const videoMergeCuePlacementSchema = z.object({
  inputPosition: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative(),
  durationMs: z.number().int().positive(),
  fadeInMs: z.number().int().nonnegative(),
  fadeOutMs: z.number().int().nonnegative(),
  gainDb: z.number().finite().min(-60).max(12),
}).strict().superRefine((cue, context) => {
  if (cue.fadeInMs > cue.durationMs) context.addIssue({ code: 'custom', path: ['fadeInMs'], message: 'fadeInMs exceeds cue duration.' })
  if (cue.fadeOutMs > cue.durationMs) context.addIssue({ code: 'custom', path: ['fadeOutMs'], message: 'fadeOutMs exceeds cue duration.' })
})

const videoMergeInputRefSchema = z.object({
  resourceId: z.string().trim().min(1),
  contentVersion: z.number().int().positive(),
  workspacePath: z.string().trim().min(1).max(512),
  role: z.enum(['source_video', 'background_music', 'replacement_audio', 'bgm_audio', 'sound_effect_audio']),
  position: z.number().int().min(0),
}).strict()

const videoMergeInputsSchema = z.array(videoMergeInputRefSchema).min(1).max(51)
  .refine(
    (inputs) => {
      const sourceCount = inputs.filter((input) => input.role === 'source_video').length
      return sourceCount >= 1 && sourceCount <= 50
    },
    { message: 'VIDEO_MERGE_SOURCE_VIDEO_COUNT_INVALID' },
  )
  .refine(
    (inputs) => new Set(inputs.map((input) => input.position)).size === inputs.length,
    { message: 'VIDEO_MERGE_INPUT_POSITIONS_DUPLICATE' },
  )

export const workspaceResourceVideoMergeTaskPayloadSchema = z.object({
  lifecycleProjection: workspaceResourceLifecycleProjectionSchema,
  protocol: z.literal('workspace_resource_video_merge_v2'),
  resource: z.object({
    resourceId: z.string().trim().min(1),
    mediaType: z.literal('video'),
    schemaId: z.literal('generic.video'),
    prompt: z.null(),
    modelKey: z.null(),
    inputHash: z.string().length(64),
    inputs: videoMergeInputsSchema,
    generationOptions: z.union([
      videoMergeGenerationOptionsSchema,
      videoMergeTimedCueGenerationOptionsSchema,
      workspaceResourceGenerationOptionsSchema,
    ]),
    musicCues: z.array(videoMergeCuePlacementSchema).max(50).default([]),
    soundCues: z.array(videoMergeCuePlacementSchema).max(50).default([]),
    toolCallId: z.string().trim().min(1).nullable(),
  }).strict().superRefine((resource, context) => {
    const sourceCount = resource.inputs.filter((input) => input.role === 'source_video').length
    const backgroundMusicCount = resource.inputs.filter((input) => input.role === 'background_music').length
    const replacementAudioCount = resource.inputs.filter((input) => input.role === 'replacement_audio').length
    const audioMode = 'audioMode' in resource.generationOptions
      ? resource.generationOptions.audioMode
      : null
    const bgmPositions = new Set(resource.inputs.filter((input) => input.role === 'bgm_audio').map((input) => input.position))
    const soundPositions = new Set(resource.inputs.filter((input) => input.role === 'sound_effect_audio').map((input) => input.position))
    const cuePositions = resource.musicCues.map((cue) => cue.inputPosition)
    const soundCuePositions = resource.soundCues.map((cue) => cue.inputPosition)
    const hasTimedCues = cuePositions.length > 0 || soundCuePositions.length > 0
    if (hasTimedCues) {
      if (
        resource.generationOptions.mergeMode !== 'timed_cues'
        || audioMode !== 'preserve'
        || sourceCount !== 1
        || backgroundMusicCount > 0
        || replacementAudioCount > 0
      ) {
        context.addIssue({ code: 'custom', path: ['generationOptions'], message: 'Timed audio cues require one source video and preserve mode without an assembly audio input.' })
      }
      if (cuePositions.length !== bgmPositions.size || new Set(cuePositions).size !== cuePositions.length || cuePositions.some((position) => !bgmPositions.has(position))) {
        context.addIssue({ code: 'custom', path: ['musicCues'], message: 'Every bgm_audio input must have exactly one music cue.' })
      }
      if (soundCuePositions.length !== soundPositions.size || new Set(soundCuePositions).size !== soundCuePositions.length || soundCuePositions.some((position) => !soundPositions.has(position))) {
        context.addIssue({ code: 'custom', path: ['soundCues'], message: 'Every sound_effect_audio input must have exactly one sound cue.' })
      }
      if (bgmPositions.size + soundPositions.size > 50) {
        context.addIssue({ code: 'custom', path: ['inputs'], message: 'Timed audio cues cannot exceed 50 inputs.' })
      }
      return
    }
    if (bgmPositions.size > 0 || soundPositions.size > 0) {
      context.addIssue({
        code: 'custom',
        path: ['inputs'],
        message: 'Timed audio inputs require matching frozen cues.',
      })
      return
    }
    if (resource.generationOptions.mergeMode !== 'ordered_concat') {
      context.addIssue({ code: 'custom', path: ['generationOptions'], message: 'Non-timed video merge requires ordered_concat mode.' })
      return
    }
    if (!audioMode) {
      context.addIssue({ code: 'custom', path: ['generationOptions'], message: 'VIDEO_MERGE_AUDIO_MODE_REQUIRED' })
      return
    }
    if (audioMode === 'preserve' && sourceCount < 2) {
      context.addIssue({ code: 'custom', path: ['inputs'], message: 'VIDEO_MERGE_PRESERVE_REQUIRES_MULTIPLE_VIDEOS' })
    }
    const validAudioInputs = audioMode === 'mix'
      ? backgroundMusicCount === 1 && replacementAudioCount === 0
      : audioMode === 'replace'
        ? replacementAudioCount === 1 && backgroundMusicCount === 0
        : backgroundMusicCount === 0 && replacementAudioCount === 0
    if (!validAudioInputs) {
      context.addIssue({ code: 'custom', path: ['inputs'], message: 'VIDEO_MERGE_AUDIO_MODE_INPUT_MISMATCH' })
    }
  }),
}).strict()

const workspaceResourceVideoMergeTaskEnvelopeSchema = workspaceResourceVideoMergeTaskPayloadSchema.extend({
  ...taskRuntimePayloadEnvelopeShape,
}).strict()

export type WorkspaceResourceVideoMergeTaskPayload = z.infer<
  typeof workspaceResourceVideoMergeTaskPayloadSchema
>

export function parseWorkspaceResourceVideoMergeTaskPayload(
  value: unknown,
): WorkspaceResourceVideoMergeTaskPayload {
  const parsed = workspaceResourceVideoMergeTaskEnvelopeSchema.parse(value)
  return workspaceResourceVideoMergeTaskPayloadSchema.parse({
    lifecycleProjection: parsed.lifecycleProjection,
    protocol: parsed.protocol,
    resource: parsed.resource,
  })
}
