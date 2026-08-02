import { z } from 'zod'
import { WORKSPACE_RESOURCE_MEDIA_TYPES } from './contracts'

export const workspaceResourceLifecycleProjectionSchema = z.object({
  resources: z.array(z.object({
    resourceId: z.string().trim().min(1),
    mediaType: z.enum(WORKSPACE_RESOURCE_MEDIA_TYPES),
    schemaId: z.string().trim().min(1),
    name: z.string().trim().min(1),
  }).strict()).min(1),
}).strict()

export type WorkspaceResourceLifecycleProjection = z.infer<
  typeof workspaceResourceLifecycleProjectionSchema
>

export function buildWorkspaceResourceLifecycleProjection(
  resources: WorkspaceResourceLifecycleProjection['resources'],
): WorkspaceResourceLifecycleProjection {
  return workspaceResourceLifecycleProjectionSchema.parse({ resources })
}
