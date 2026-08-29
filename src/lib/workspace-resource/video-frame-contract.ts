import { z } from 'zod'
import { taskRuntimePayloadEnvelopeShape } from '@/lib/task/progress-payload'
import { workspaceResourceLifecycleProjectionSchema } from './task-runtime-envelope'

export const VIDEO_FRAME_SELECTORS = ['last_decodable'] as const
export const videoFrameSelectorSchema = z.enum(VIDEO_FRAME_SELECTORS)
export type VideoFrameSelector = z.infer<typeof videoFrameSelectorSchema>

export const videoFrameGenerationOptionsSchema = z.object({
  selector: videoFrameSelectorSchema,
  outputFormat: z.literal('png'),
}).strict()

const videoFrameInputRefSchema = z.object({
  resourceId: z.string().trim().min(1),
  contentVersion: z.number().int().positive(),
  workspacePath: z.string().trim().min(1).max(512),
  role: z.literal('source_video'),
  position: z.literal(0),
}).strict()

export const workspaceResourceVideoFrameTaskPayloadSchema = z.object({
  lifecycleProjection: workspaceResourceLifecycleProjectionSchema,
  protocol: z.literal('workspace_resource_video_frame_v1'),
  resource: z.object({
    resourceId: z.string().trim().min(1),
    mediaType: z.literal('image'),
    schemaId: z.literal('generic.image'),
    prompt: z.null(),
    modelKey: z.null(),
    inputHash: z.string().length(64),
    inputs: z.array(videoFrameInputRefSchema).length(1),
    generationOptions: videoFrameGenerationOptionsSchema,
    toolCallId: z.string().trim().min(1).nullable(),
  }).strict(),
}).strict()

const workspaceResourceVideoFrameTaskEnvelopeSchema = workspaceResourceVideoFrameTaskPayloadSchema.extend({
  ...taskRuntimePayloadEnvelopeShape,
}).strict()

export type WorkspaceResourceVideoFrameTaskPayload = z.infer<
  typeof workspaceResourceVideoFrameTaskPayloadSchema
>

export function parseWorkspaceResourceVideoFrameTaskPayload(
  value: unknown,
): WorkspaceResourceVideoFrameTaskPayload {
  const parsed = workspaceResourceVideoFrameTaskEnvelopeSchema.parse(value)
  return workspaceResourceVideoFrameTaskPayloadSchema.parse({
    lifecycleProjection: parsed.lifecycleProjection,
    protocol: parsed.protocol,
    resource: parsed.resource,
  })
}
