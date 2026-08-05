import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { softDeleteWorkspaceResourceInTransaction } from '@/lib/workspace-resource/persistence'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'

export async function deleteVoiceResourceInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    readonly userId: string
    readonly projectId: string
    readonly resourceId: string
  },
): Promise<{ success: true }> {
  const resource = await tx.workspaceResource.findFirst({
    where: {
      id: input.resourceId,
      userId: input.userId,
      projectId: input.projectId,
      resourceKind: 'file',
      mediaType: 'audio',
      schemaId: WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE,
      deletedAt: null,
    },
    select: { id: true, workspacePath: true },
  })
  if (!resource) {
    throw new ApiError('NOT_FOUND', { code: 'VOICE_RESOURCE_NOT_FOUND', field: 'target.assetId' })
  }
  await softDeleteWorkspaceResourceInTransaction(tx, {
    userId: input.userId,
    projectId: input.projectId,
    resourceId: resource.id,
    workspacePath: resource.workspacePath,
  })
  return { success: true }
}
