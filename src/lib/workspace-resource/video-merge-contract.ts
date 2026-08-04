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
    (inputs) => inputs.filter((input) => input.role === 'bgm_audio').length <= 1,
    { message: 'VIDEO_MERGE_BGM_INPUT_SINGLE' },
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
  resource: z.object({
    resourceId: z.string().trim().min(1),
    mediaType: z.literal('video'),
    schemaId: z.literal('generic.video'),
    prompt: z.null(),
    modelKey: z.null(),
    inputHash: z.string().length(64),
    inputs: videoMergeInputsSchema,
    generationOptions: workspaceResourceGenerationOptionsSchema,
    toolCallId: z.string().trim().min(1).nullable(),
  }).strict(),
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
