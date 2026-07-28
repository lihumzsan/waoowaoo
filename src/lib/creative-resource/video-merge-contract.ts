import { z } from 'zod'
import { creativeResourceGenerationOptionsSchema } from './generation-contract'
import {
  creativeResourceLifecycleProjectionSchema,
  creativeResourceTaskRuntimeEnvelopeShape,
} from './task-runtime-envelope'

const videoMergeInputRefSchema = z.object({
  resourceId: z.string().trim().min(1),
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

export const creativeResourceVideoMergeTaskPayloadSchema = z.object({
  lifecycleProjection: creativeResourceLifecycleProjectionSchema,
  resource: z.object({
    resourceId: z.string().trim().min(1),
    mediaType: z.literal('video'),
    schemaId: z.literal('generic.video'),
    prompt: z.null(),
    modelKey: z.null(),
    inputHash: z.string().trim().min(1),
    inputs: videoMergeInputsSchema,
    generationOptions: creativeResourceGenerationOptionsSchema,
    executionSegmentId: z.string().trim().min(1).nullable(),
    toolCallId: z.string().trim().min(1).nullable(),
  }).strict(),
}).strict()

const creativeResourceVideoMergeTaskEnvelopeSchema = creativeResourceVideoMergeTaskPayloadSchema.extend({
  ...creativeResourceTaskRuntimeEnvelopeShape,
}).strict()

export type CreativeResourceVideoMergeTaskPayload = z.infer<
  typeof creativeResourceVideoMergeTaskPayloadSchema
>

export function parseCreativeResourceVideoMergeTaskPayload(
  value: unknown,
): CreativeResourceVideoMergeTaskPayload {
  const parsed = creativeResourceVideoMergeTaskEnvelopeSchema.parse(value)
  return creativeResourceVideoMergeTaskPayloadSchema.parse({
    lifecycleProjection: parsed.lifecycleProjection,
    resource: parsed.resource,
  })
}
