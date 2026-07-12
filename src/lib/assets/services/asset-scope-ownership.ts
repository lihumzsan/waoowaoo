import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import type { AssetKind, AssetScope } from '@/lib/assets/contracts'
import { prisma } from '@/lib/prisma'

export type AssetWriteAccess = {
  readonly scope: AssetScope
  readonly userId: string
  readonly projectId?: string
}

export type AssetOwnershipClient = Pick<
  Prisma.TransactionClient,
  | 'project'
  | 'projectCharacter'
  | 'projectLocation'
  | 'characterAppearance'
  | 'locationImage'
  | 'globalCharacter'
  | 'globalLocation'
  | 'globalCharacterAppearance'
  | 'globalLocationImage'
>

function targetNotFound(details: Record<string, unknown>): never {
  throw new ApiError('NOT_FOUND', {
    code: 'ASSET_SCOPE_TARGET_NOT_FOUND',
    ...details,
  })
}

export function requireAssetProjectId(access: AssetWriteAccess): string {
  const projectId = access.projectId?.trim()
  if (!projectId) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'ASSET_PROJECT_ID_REQUIRED',
      field: 'projectId',
    })
  }
  return projectId
}

export async function requireOwnedAssetProject(
  access: AssetWriteAccess,
  client: AssetOwnershipClient = prisma,
): Promise<string> {
  const projectId = requireAssetProjectId(access)
  const project = await client.project.findFirst({
    where: { id: projectId, userId: access.userId },
    select: { id: true },
  })
  if (!project) targetNotFound({ scope: 'project', projectId })
  return projectId
}

export async function requireOwnedAssetTarget(
  input: {
    readonly access: AssetWriteAccess
    readonly kind: AssetKind
    readonly assetId: string
  },
  client: AssetOwnershipClient = prisma,
): Promise<void> {
  if (input.access.scope === 'global') {
    const asset = input.kind === 'character'
      ? await client.globalCharacter.findFirst({
          where: { id: input.assetId, userId: input.access.userId },
          select: { id: true },
        })
      : await client.globalLocation.findFirst({
          where: {
            id: input.assetId,
            userId: input.access.userId,
            assetKind: input.kind,
          },
          select: { id: true },
        })
    if (!asset) {
      targetNotFound({ scope: 'global', kind: input.kind, assetId: input.assetId })
    }
    return
  }

  const projectId = requireAssetProjectId(input.access)
  const asset = input.kind === 'character'
    ? await client.projectCharacter.findFirst({
        where: {
          id: input.assetId,
          projectId,
          project: { userId: input.access.userId },
        },
        select: { id: true },
      })
    : await client.projectLocation.findFirst({
        where: {
          id: input.assetId,
          projectId,
          assetKind: input.kind,
          project: { userId: input.access.userId },
        },
        select: { id: true },
      })
  if (!asset) {
    targetNotFound({ scope: 'project', projectId, kind: input.kind, assetId: input.assetId })
  }
}

export async function requireOwnedAssetVariant(
  input: {
    readonly access: AssetWriteAccess
    readonly kind: AssetKind
    readonly assetId: string
    readonly variantId: string
  },
  client: AssetOwnershipClient = prisma,
): Promise<void> {
  await requireOwnedAssetTarget(input, client)

  if (input.access.scope === 'global') {
    const variant = input.kind === 'character'
      ? await client.globalCharacterAppearance.findFirst({
          where: {
            id: input.variantId,
            characterId: input.assetId,
            character: { userId: input.access.userId },
          },
          select: { id: true },
        })
      : await client.globalLocationImage.findFirst({
          where: {
            id: input.variantId,
            locationId: input.assetId,
            location: {
              userId: input.access.userId,
              assetKind: input.kind,
            },
          },
          select: { id: true },
        })
    if (!variant) {
      targetNotFound({ scope: 'global', kind: input.kind, assetId: input.assetId, variantId: input.variantId })
    }
    return
  }

  const projectId = requireAssetProjectId(input.access)
  const variant = input.kind === 'character'
    ? await client.characterAppearance.findFirst({
        where: {
          id: input.variantId,
          characterId: input.assetId,
          character: {
            projectId,
            project: { userId: input.access.userId },
          },
        },
        select: { id: true },
      })
    : await client.locationImage.findFirst({
        where: {
          id: input.variantId,
          locationId: input.assetId,
          location: {
            projectId,
            assetKind: input.kind,
            project: { userId: input.access.userId },
          },
        },
        select: { id: true },
      })
  if (!variant) {
    targetNotFound({ scope: 'project', projectId, kind: input.kind, assetId: input.assetId, variantId: input.variantId })
  }
}

export async function requireAssetBodyVariantOwnership(
  input: {
    readonly access: AssetWriteAccess
    readonly kind: AssetKind
    readonly assetId: string
    readonly body: Readonly<Record<string, unknown>>
  },
  client: AssetOwnershipClient = prisma,
): Promise<void> {
  await requireOwnedAssetTarget(input, client)
  const candidate = input.kind === 'character'
    ? input.body.appearanceId ?? input.body.variantId
    : input.body.locationImageId ?? input.body.variantId
  if (typeof candidate !== 'string' || !candidate.trim()) return
  await requireOwnedAssetVariant({
    access: input.access,
    kind: input.kind,
    assetId: input.assetId,
    variantId: candidate.trim(),
  }, client)
}
