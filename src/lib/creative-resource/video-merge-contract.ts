import { z } from 'zod'
import { creativeResourceGenerationOptionsSchema } from './generation-contract'
import {
  creativeResourceLifecycleProjectionSchema,
  creativeResourceTaskRuntimeEnvelopeShape,
} from './task-runtime-envelope'

const videoMergeInputRefSchema = z.object({
  revisionId: z.string().trim().min(1),
  role: z.literal('source_video'),
  position: z.number().int().min(0),
}).strict()

export const creativeResourceVideoMergeTaskPayloadSchema = z.object({
  lifecycleProjection: creativeResourceLifecycleProjectionSchema,
  resource: z.object({
    resourceId: z.string().trim().min(1),
    mediaType: z.literal('video'),
    schemaId: z.literal('generic.video'),
    prompt: z.null(),
    modelKey: z.null(),
    inputHash: z.string().trim().min(1),
    inputs: z.array(videoMergeInputRefSchema).min(2).max(50),
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
