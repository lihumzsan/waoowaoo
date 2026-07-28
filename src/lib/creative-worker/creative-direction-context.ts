import type { Prisma } from '@prisma/client'
import {
  creativeDirectionSchema,
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
  readonly resourceId: string
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
    || binding.resource.userId !== input.userId
    || binding.resource.projectId !== input.projectId
    || binding.resource.episodeId !== null
    || binding.resource.scopeKind !== 'project'
    || binding.resource.scopeId !== input.projectId
    || binding.resource.status !== 'ready'
    || binding.resource.mediaType !== 'text'
    || binding.resource.schemaId !== CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION
    || binding.resource.contentJson === null
  ) {
    throw new Error('CREATIVE_DIRECTION_ADOPTED_BINDING_INVALID')
  }
  return {
    resourceId: binding.resource.id,
    direction: creativeDirectionSchema.parse(binding.resource.contentJson),
  }
}

export function projectAdoptedCreativeDirection(input: {
  readonly snapshot: AdoptedCreativeDirectionSnapshot | null
  readonly outputKind: CreativeWorkOutputKind
}): InjectedCreativeDirection | null {
  const injectCreativeDirection = readCreativeWorkOutputDefinition(
    input.outputKind,
  ).injectCreativeDirection
  if (!input.snapshot || !injectCreativeDirection) return null
  return {
    resourceId: input.snapshot.resourceId,
    direction: input.snapshot.direction,
  }
}
