import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export async function advanceWorkspaceResourceRevisionInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    readonly projectId: string
    readonly userId: string
  },
): Promise<number> {
  const project = await tx.project.update({
    where: {
      id: input.projectId,
      userId: input.userId,
    },
    data: {
      workspaceResourceRevision: { increment: 1 },
    },
    select: { workspaceResourceRevision: true },
  })
  return project.workspaceResourceRevision
}

export async function readWorkspaceResourceRevision(input: {
  readonly projectId: string
  readonly userId: string
}): Promise<number> {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, userId: input.userId },
    select: { workspaceResourceRevision: true },
  })
  if (!project) throw new Error('WORKSPACE_RESOURCE_PROJECT_NOT_OWNED')
  return project.workspaceResourceRevision
}
