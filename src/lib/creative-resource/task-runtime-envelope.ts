import { z } from 'zod'
import { ASYNC_PENDING_PHASES } from '@/lib/ai-providers/async-task-types'
import { CREATIVE_RESOURCE_MEDIA_TYPES } from './contracts'

export const creativeResourceLifecycleProjectionSchema = z.object({
  resources: z.array(z.object({
    resourceId: z.string().trim().min(1),
    mediaType: z.enum(CREATIVE_RESOURCE_MEDIA_TYPES),
    schemaId: z.string().trim().min(1),
    name: z.string().trim().min(1),
  }).strict()).min(1),
}).strict()

export type CreativeResourceLifecycleProjection = z.infer<
  typeof creativeResourceLifecycleProjectionSchema
>

export function buildCreativeResourceLifecycleProjection(
  resources: CreativeResourceLifecycleProjection['resources'],
): CreativeResourceLifecycleProjection {
  return creativeResourceLifecycleProjectionSchema.parse({ resources })
}

/**
 * Runtime-owned fields that Task submission and progress reporting may add to
 * a persisted Creative Resource payload. Domain parsers stay strict while all
 * Creative Resource Task kinds share this single exhaustive envelope, so every
 * new progress field a worker reports must be declared here — an undeclared key
 * makes every later parse of that Task payload throw, which fails the whole
 * resource list read, not just the one task.
 */
export const creativeResourceTaskRuntimeEnvelopeShape = {
  ui: z.record(z.string(), z.unknown()).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  externalId: z.string().trim().min(1).optional(),
  sync: z.number().optional(),
  flowId: z.string().optional(),
  flowStageIndex: z.number().optional(),
  flowStageTotal: z.number().optional(),
  flowStageTitle: z.string().optional(),
  stage: z.string().optional(),
  stageLabel: z.string().optional(),
  displayMode: z.string().optional(),
  message: z.string().optional(),
  externalPhase: z.enum(ASYNC_PENDING_PHASES).optional(),
}
