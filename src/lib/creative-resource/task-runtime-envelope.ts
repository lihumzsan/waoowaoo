import { z } from 'zod'
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
