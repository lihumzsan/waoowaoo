import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { TASK_STATUS } from '@/lib/task/types'

export interface SetCreativeResourceArchivedResult {
  readonly resourceId: string
  readonly archivedAt: string | null
  readonly changed: boolean
}

export async function setCreativeResourceArchivedInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    readonly userId: string
    readonly projectId: string
    readonly resourceId: string
    readonly archived: boolean
  },
): Promise<SetCreativeResourceArchivedResult> {
  const resource = await tx.creativeResource.findFirst({
    where: {
      id: input.resourceId,
      userId: input.userId,
      projectId: input.projectId,
    },
    select: {
      id: true,
      status: true,
      archivedAt: true,
    },
  })
  if (!resource) {
    throw new ApiError('NOT_FOUND', {
      code: 'CREATIVE_RESOURCE_NOT_FOUND',
      field: 'resourceId',
    })
  }

  const alreadyInRequestedState = input.archived
    ? resource.archivedAt !== null
    : resource.archivedAt === null
  if (alreadyInRequestedState) {
    return {
      resourceId: resource.id,
      archivedAt: resource.archivedAt?.toISOString() ?? null,
      changed: false,
    }
  }

  if (input.archived) {
    const activeTask = await tx.task.findFirst({
      where: {
        targetType: 'CreativeResource',
        targetId: resource.id,
        status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
      },
      select: { id: true },
    })
    if (resource.status === 'pending' || activeTask) {
      throw new ApiError('CONFLICT', {
        code: 'CREATIVE_RESOURCE_ARCHIVE_ACTIVE',
        field: 'resourceId',
      })
    }
  }

  const archivedAt = input.archived ? new Date() : null
  const updated = await tx.creativeResource.updateMany({
    where: {
      id: resource.id,
      userId: input.userId,
      projectId: input.projectId,
      archivedAt: input.archived ? null : { not: null },
    },
    data: { archivedAt },
  })
  const stored = await tx.creativeResource.findUniqueOrThrow({
    where: { id: resource.id },
    select: { archivedAt: true },
  })
  return {
    resourceId: resource.id,
    archivedAt: stored.archivedAt?.toISOString() ?? null,
    changed: updated.count > 0,
  }
}
