import type { Prisma } from '@prisma/client'
import {
  creativeDirectionSchema,
  projectCreativeDirection,
  type CreativeDirection,
  type InjectedCreativeDirection,
} from '@/lib/creative-direction/contracts'
import {
  CREATIVE_RESOURCE_CANONICAL_BINDINGS,
  CREATIVE_RESOURCE_SCHEMA,
} from '@/lib/creative-resource'
import { prisma } from '@/lib/prisma'
import { readCreativeWorkOutputDefinition } from './output-registry'
import type { CreativeWorkOutputKind } from './types'

type CreativeDirectionReadClient = Pick<Prisma.TransactionClient, 'creativeResourceBinding'>
  | typeof prisma

export interface AdoptedCreativeDirectionSnapshot {
  readonly revisionId: string
  readonly direction: CreativeDirection
}

export async function readAdoptedCreativeDirectionSnapshot(input: {
  readonly projectId: string
  readonly userId: string
  readonly client?: CreativeDirectionReadClient
}): Promise<AdoptedCreativeDirectionSnapshot | null> {
  const client = input.client ?? prisma
  const binding = await client.creativeResourceBinding.findUnique({
    where: {
      scopeKind_scopeId_role_slotKey: {
        scopeKind: 'project',
        scopeId: input.projectId,
        ...CREATIVE_RESOURCE_CANONICAL_BINDINGS.adoptedCreativeDirection,
      },
    },
    select: {
      userId: true,
      projectId: true,
      resourceId: true,
      revisionId: true,
      resource: {
        select: {
          id: true,
          userId: true,
          projectId: true,
          episodeId: true,
          scopeKind: true,
          scopeId: true,
          status: true,
          mediaType: true,
          schemaId: true,
        },
      },
      revision: {
        select: {
          id: true,
          resourceId: true,
          contentJson: true,
        },
      },
    },
  })
  if (!binding) return null
  if (
    binding.userId !== input.userId
    || binding.projectId !== input.projectId
    || binding.resourceId !== binding.resource.id
    || binding.revisionId !== binding.revision.id
    || binding.revision.resourceId !== binding.resource.id
    || binding.resource.userId !== input.userId
    || binding.resource.projectId !== input.projectId
    || binding.resource.episodeId !== null
    || binding.resource.scopeKind !== 'project'
    || binding.resource.scopeId !== input.projectId
    || binding.resource.status !== 'ready'
    || binding.resource.mediaType !== 'text'
    || binding.resource.schemaId !== CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION
    || binding.revision.contentJson === null
  ) {
    throw new Error('CREATIVE_DIRECTION_ADOPTED_BINDING_INVALID')
  }
  return {
    revisionId: binding.revision.id,
    direction: creativeDirectionSchema.parse(binding.revision.contentJson),
  }
}

export function projectAdoptedCreativeDirection(input: {
  readonly snapshot: AdoptedCreativeDirectionSnapshot | null
  readonly outputKind: CreativeWorkOutputKind
}): InjectedCreativeDirection | null {
  const domains = readCreativeWorkOutputDefinition(input.outputKind).creativeDirectionDomains
  if (!input.snapshot || domains.length === 0) return null
  return {
    revisionId: input.snapshot.revisionId,
    direction: projectCreativeDirection(input.snapshot.direction, domains),
  }
}
