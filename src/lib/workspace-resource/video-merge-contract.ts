import { z } from 'zod'
import { taskRuntimePayloadEnvelopeShape } from '@/lib/task/progress-payload'
import {
  workspaceResourceLifecycleProjectionSchema,
} from './task-runtime-envelope'

export const VIDEO_MERGE_AUDIO_MODES = ['preserve', 'mix', 'replace', 'mute'] as const
export const videoMergeAudioModeSchema = z.enum(VIDEO_MERGE_AUDIO_MODES)
export type VideoMergeAudioMode = z.infer<typeof videoMergeAudioModeSchema>

export const videoMergeGenerationOptionsSchema = z.object({
  mergeMode: z.literal('ordered_concat'),
  audioMode: videoMergeAudioModeSchema,
}).strict()

const videoMergeInputRefSchema = z.object({
  resourceId: z.string().trim().min(1),
  contentVersion: z.number().int().positive(),
  workspacePath: z.string().trim().min(1).max(512),
  role: z.enum(['source_video', 'background_music', 'replacement_audio']),
  position: z.number().int().min(0),
}).strict()

const videoMergeInputsSchema = z.array(videoMergeInputRefSchema).min(1).max(51)
  .refine(
    (inputs) => inputs.filter((input) => input.role !== 'source_video').length <= 1,
    { message: 'VIDEO_MERGE_AUDIO_INPUT_SINGLE' },
  )
  .refine(
    (inputs) => {
      const sourceCount = inputs.filter((input) => input.role === 'source_video').length
      return sourceCount >= 1 && sourceCount <= 50
    },
    { message: 'VIDEO_MERGE_SOURCE_VIDEO_COUNT_INVALID' },
  )

export const workspaceResourceVideoMergeTaskPayloadSchema = z.object({
  lifecycleProjection: workspaceResourceLifecycleProjectionSchema,
  protocol: z.literal('workspace_resource_video_merge_v1'),
  resource: z.object({
    resourceId: z.string().trim().min(1),
    mediaType: z.literal('video'),
    schemaId: z.literal('generic.video'),
    prompt: z.null(),
    modelKey: z.null(),
    inputHash: z.string().length(64),
    inputs: videoMergeInputsSchema,
    generationOptions: videoMergeGenerationOptionsSchema,
    toolCallId: z.string().trim().min(1).nullable(),
  }).strict().superRefine((resource, context) => {
    const sourceCount = resource.inputs.filter((input) => input.role === 'source_video').length
    const backgroundMusicCount = resource.inputs.filter((input) => input.role === 'background_music').length
    const replacementAudioCount = resource.inputs.filter((input) => input.role === 'replacement_audio').length
    const audioMode = resource.generationOptions.audioMode
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
