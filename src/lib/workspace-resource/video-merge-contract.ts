import { z } from 'zod'
import { taskRuntimePayloadEnvelopeShape } from '@/lib/task/progress-payload'
import { workspaceResourceGenerationOptionsSchema } from './generation-contract'
import {
  workspaceResourceLifecycleProjectionSchema,
} from './task-runtime-envelope'

const videoMergeInputRefSchema = z.object({
  resourceId: z.string().trim().min(1),
  contentVersion: z.number().int().positive(),
  workspacePath: z.string().trim().min(1).max(512),
  role: z.enum(['source_video', 'bgm_audio']),
  position: z.number().int().min(0),
}).strict()

const videoMergeInputsSchema = z.array(videoMergeInputRefSchema).min(2).max(51)
  .refine(
    (inputs) => {
      const sourceCount = inputs.filter((input) => input.role === 'source_video').length
      return sourceCount >= 1 && sourceCount <= 50
    },
    { message: 'VIDEO_MERGE_SOURCE_VIDEO_COUNT_INVALID' },
  )

export const workspaceResourceVideoMergeTaskPayloadSchema = z.object({
  lifecycleProjection: workspaceResourceLifecycleProjectionSchema,
  resource: z.object({
    resourceId: z.string().trim().min(1),
    mediaType: z.literal('video'),
    schemaId: z.literal('generic.video'),
    prompt: z.null(),
    modelKey: z.null(),
    inputHash: z.string().length(64),
    inputs: videoMergeInputsSchema,
    generationOptions: workspaceResourceGenerationOptionsSchema,
    musicCues: z.array(z.object({
      inputPosition: z.number().int().nonnegative(),
      startMs: z.number().int().nonnegative(),
      durationMs: z.number().int().positive(),
      fadeInMs: z.number().int().nonnegative(),
      fadeOutMs: z.number().int().nonnegative(),
      gainDb: z.number().finite().min(-60).max(12),
    }).strict().superRefine((cue, context) => {
      if (cue.fadeInMs > cue.durationMs) {
        context.addIssue({ code: 'custom', path: ['fadeInMs'], message: 'fadeInMs exceeds cue duration.' })
      }
      if (cue.fadeOutMs > cue.durationMs) {
        context.addIssue({ code: 'custom', path: ['fadeOutMs'], message: 'fadeOutMs exceeds cue duration.' })
      }
    })).max(50),
    toolCallId: z.string().trim().min(1).nullable(),
  }).strict().superRefine((resource, context) => {
    const bgmPositions = new Set(
      resource.inputs
        .filter((reference) => reference.role === 'bgm_audio')
        .map((reference) => reference.position),
    )
    const cuePositions = resource.musicCues.map((cue) => cue.inputPosition)
    if (
      cuePositions.length !== bgmPositions.size
      || new Set(cuePositions).size !== cuePositions.length
      || cuePositions.some((position) => !bgmPositions.has(position))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['musicCues'],
        message: 'Every bgm_audio input must have exactly one frozen cue placement.',
      })
    }
    const sourceCount = resource.inputs.filter((reference) => reference.role === 'source_video').length
    if (resource.musicCues.length > 0 && sourceCount !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['musicCues'],
        message: 'Music cues can only be placed onto one already-merged source video.',
      })
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
    resource: parsed.resource,
  })
}
