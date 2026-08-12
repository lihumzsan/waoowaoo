import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireProductionProfileDefinition } from './registry'
import type { ProductionProfileDefinition, ProductionProfileId } from './types'

type ProjectProfileClient = Pick<Prisma.TransactionClient, 'project'>

export class ProjectProductionProfileError extends Error {
  constructor(code: string) {
    super(code)
    this.name = 'ProjectProductionProfileError'
  }
}

export async function readOwnedProjectProductionProfile(input: {
  readonly projectId: string
  readonly userId: string
  readonly client?: ProjectProfileClient
}): Promise<ProductionProfileDefinition> {
  const client = input.client ?? prisma
  const project = await client.project.findFirst({
    where: { id: input.projectId, userId: input.userId },
    select: {
      productionProfileId: true,
      productionProfileVersion: true,
    },
  })
  if (!project) {
    throw new ProjectProductionProfileError('PROJECT_PRODUCTION_PROFILE_NOT_OWNED')
  }
  try {
    return requireProductionProfileDefinition(
      project.productionProfileId,
      project.productionProfileVersion,
    )
  } catch (error) {
    throw new ProjectProductionProfileError(
      error instanceof Error ? error.message : 'PROJECT_PRODUCTION_PROFILE_INVALID',
    )
  }
}

export async function readOwnedProjectProductionProfileId(input: {
  readonly projectId: string
  readonly userId: string
}): Promise<ProductionProfileId> {
  return (await readOwnedProjectProductionProfile(input)).id
}
