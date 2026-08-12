import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { readOwnedProjectProductionProfile } from './project-profile'
import type {
  ProductionJourneyStageDefinition,
  ProductionJourneyStageView,
  ProductionJourneyStatus,
  ProductionJourneyView,
} from './types'

type ProductionJourneyClient = Pick<Prisma.TransactionClient, 'project' | 'workspaceResource'>

function resolveStageStatus(
  resources: readonly { readonly status: string }[],
): ProductionJourneyStatus {
  if (resources.length === 0) return 'not_started'
  if (resources.some((resource) => resource.status === 'pending')) return 'in_progress'
  if (resources.some((resource) => (
    resource.status === 'failed'
    || resource.status === 'canceled'
  ))) return 'needs_attention'
  if (resources.some((resource) => resource.status === 'ready')) return 'completed'
  return 'not_started'
}

function projectStage(
  stage: ProductionJourneyStageDefinition,
  resources: readonly {
    readonly id: string
    readonly schemaId: string
    readonly status: string
  }[],
): ProductionJourneyStageView {
  const matching = resources.filter((resource) => stage.schemaIds.includes(
    resource.schemaId as (typeof stage.schemaIds)[number],
  ))
  return {
    id: stage.id,
    status: resolveStageStatus(matching),
    resourceIds: matching.map((resource) => resource.id),
  }
}

export async function readProductionJourneyView(input: {
  readonly projectId: string
  readonly userId: string
  readonly client?: ProductionJourneyClient
}): Promise<ProductionJourneyView | null> {
  const client = input.client ?? prisma
  const profile = await readOwnedProjectProductionProfile({
    projectId: input.projectId,
    userId: input.userId,
    client,
  })
  if (profile.journey === null) return null
  const schemaIds = Array.from(new Set(profile.journey.flatMap((stage) => stage.schemaIds)))
  const resources = await client.workspaceResource.findMany({
    where: {
      projectId: input.projectId,
      userId: input.userId,
      deletedAt: null,
      activePath: { not: null },
      schemaId: { in: schemaIds },
    },
    select: { id: true, schemaId: true, status: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  return {
    profileId: profile.id,
    profileVersion: profile.version,
    stages: profile.journey.map((stage) => projectStage(stage, resources)),
  }
}
