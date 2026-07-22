import { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { PRIMARY_APPEARANCE_INDEX } from '@/lib/constants'
import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'

export type ProjectAssetKind = 'character' | 'location' | 'prop'

export interface ProjectAssetWriteResult {
  readonly kind: ProjectAssetKind
  readonly assetId: string
  readonly variantId: string
  readonly created: boolean
}

function normalizeRequired(value: string, code: string): string {
  const normalized = value.trim()
  if (!normalized) throw new ApiError('INVALID_PARAMS', { code })
  return normalized
}

function canonicalEntityId(value: string | null | undefined): string | null {
  const normalized = value?.trim() || null
  if (normalized && normalized.length > 80) {
    throw new ApiError('INVALID_PARAMS', { code: 'CANONICAL_ENTITY_ID_INVALID' })
  }
  return normalized
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function assetConflict(kind: ProjectAssetKind, name: string): ApiError {
  return new ApiError('CONFLICT', {
    code: 'PROJECT_ASSET_IDENTITY_CONFLICT',
    assetKind: kind,
    name,
  })
}

/** Unique writer for new Project character/location/prop identities. It never generates media. */
export async function createOrReuseProjectAssetInTransaction(input: {
  readonly tx: Prisma.TransactionClient
  readonly projectId: string
  readonly kind: ProjectAssetKind
  readonly name: string
  readonly summary?: string | null
  readonly stableDescription: string
  readonly canonicalEntityId?: string | null
  readonly imageSlotCount?: number
}): Promise<ProjectAssetWriteResult> {
  const projectId = normalizeRequired(input.projectId, 'PROJECT_ID_REQUIRED')
  const name = normalizeRequired(input.name, 'PROJECT_ASSET_NAME_REQUIRED')
  const stableDescription = normalizeRequired(
    input.stableDescription,
    'PROJECT_ASSET_STABLE_DESCRIPTION_REQUIRED',
  )
  const entityId = canonicalEntityId(input.canonicalEntityId)
  const project = await input.tx.project.findUnique({ where: { id: projectId }, select: { id: true } })
  if (!project) throw new ApiError('NOT_FOUND', { code: 'PROJECT_NOT_FOUND' })

  if (input.kind === 'character') {
    if (entityId) {
      const existing = await input.tx.projectCharacter.findUnique({
        where: { projectId_canonicalEntityId: { projectId, canonicalEntityId: entityId } },
        select: {
          id: true,
          appearances: {
            where: { appearanceIndex: PRIMARY_APPEARANCE_INDEX },
            select: { id: true },
            take: 1,
          },
        },
      })
      const variantId = existing?.appearances[0]?.id
      if (existing && variantId) {
        return { kind: input.kind, assetId: existing.id, variantId, created: false }
      }
    }
    const conflictingName = await input.tx.projectCharacter.findUnique({
      where: { projectId_name: { projectId, name } },
      select: {
        id: true,
        canonicalEntityId: true,
        appearances: {
          where: { appearanceIndex: PRIMARY_APPEARANCE_INDEX },
          select: { id: true },
          take: 1,
        },
      },
    })
    if (conflictingName) {
      if (entityId && !conflictingName.canonicalEntityId) {
        const attached = await input.tx.projectCharacter.update({
          where: { id: conflictingName.id },
          data: { canonicalEntityId: entityId },
          select: { id: true },
        })
        const variantId = conflictingName.appearances[0]?.id
        if (!variantId) throw new Error(`PROJECT_CHARACTER_PRIMARY_APPEARANCE_MISSING:${attached.id}`)
        return { kind: input.kind, assetId: attached.id, variantId, created: false }
      }
      throw assetConflict(input.kind, name)
    }
    try {
      const character = await input.tx.projectCharacter.create({
        data: { projectId, name, aliases: null, canonicalEntityId: entityId },
        select: { id: true },
      })
      const appearance = await input.tx.characterAppearance.create({
        data: {
          characterId: character.id,
          appearanceIndex: PRIMARY_APPEARANCE_INDEX,
          changeReason: 'initial',
          description: stableDescription,
          descriptions: JSON.stringify([stableDescription]),
          imageUrls: encodeImageUrls([]),
          previousImageUrls: encodeImageUrls([]),
        },
      })
      return { kind: input.kind, assetId: character.id, variantId: appearance.id, created: true }
    } catch (error) {
      if (isUniqueConstraintError(error)) throw assetConflict(input.kind, name)
      throw error
    }
  }

  if (entityId) {
    const existing = await input.tx.projectLocation.findUnique({
      where: {
        projectId_assetKind_canonicalEntityId: {
          projectId,
          assetKind: input.kind,
          canonicalEntityId: entityId,
        },
      },
      select: { id: true },
    })
    if (existing) {
      const variant = await input.tx.locationImage.findUnique({
        where: { locationId_imageIndex: { locationId: existing.id, imageIndex: 0 } },
        select: { id: true },
      })
      if (!variant) throw new Error(`PROJECT_LOCATION_PRIMARY_IMAGE_MISSING:${existing.id}`)
      return { kind: input.kind, assetId: existing.id, variantId: variant.id, created: false }
    }
  }
  const conflictingName = await input.tx.projectLocation.findUnique({
    where: { projectId_assetKind_name: { projectId, assetKind: input.kind, name } },
      select: { id: true, canonicalEntityId: true },
  })
  if (conflictingName) {
    if (entityId && !conflictingName.canonicalEntityId) {
      const attached = await input.tx.projectLocation.update({
        where: { id: conflictingName.id },
        data: { canonicalEntityId: entityId },
        select: { id: true },
      })
      const variant = await input.tx.locationImage.findUnique({
        where: { locationId_imageIndex: { locationId: attached.id, imageIndex: 0 } },
        select: { id: true },
      })
      if (!variant) throw new Error(`PROJECT_LOCATION_PRIMARY_IMAGE_MISSING:${attached.id}`)
      return { kind: input.kind, assetId: attached.id, variantId: variant.id, created: false }
    }
    throw assetConflict(input.kind, name)
  }
  const imageSlotCount = input.imageSlotCount ?? 1
  if (!Number.isInteger(imageSlotCount) || imageSlotCount < 1 || imageSlotCount > 6) {
    throw new ApiError('INVALID_PARAMS', { code: 'PROJECT_ASSET_IMAGE_SLOT_COUNT_INVALID' })
  }
  try {
    const location = await input.tx.projectLocation.create({
      data: {
        projectId,
        name,
        assetKind: input.kind,
        canonicalEntityId: entityId,
        summary: input.summary?.trim() || null,
      },
      select: { id: true },
    })
    await input.tx.locationImage.createMany({
      data: Array.from({ length: imageSlotCount }, (_value, imageIndex) => ({
        locationId: location.id,
        imageIndex,
        description: stableDescription,
      })),
    })
    const variant = await input.tx.locationImage.findUnique({
      where: { locationId_imageIndex: { locationId: location.id, imageIndex: 0 } },
      select: { id: true },
    })
    if (!variant) throw new Error(`PROJECT_LOCATION_PRIMARY_IMAGE_MISSING:${location.id}`)
    return { kind: input.kind, assetId: location.id, variantId: variant.id, created: true }
  } catch (error) {
    if (isUniqueConstraintError(error)) throw assetConflict(input.kind, name)
    throw error
  }
}
