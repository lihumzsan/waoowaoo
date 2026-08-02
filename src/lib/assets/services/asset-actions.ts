import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import type { AssetKind } from '@/lib/assets/contracts'
import { PRIMARY_APPEARANCE_INDEX } from '@/lib/constants'
import { decodeImageUrlsFromDb, encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import {
  createGlobalLocationBackedAsset,
  deleteGlobalLocationBackedAsset,
  type LocationBackedAssetKind,
} from '@/lib/assets/services/location-backed-assets'
import {
  requireAssetBodyVariantOwnership,
  requireOwnedAssetTarget,
  requireOwnedAssetVariant,
  type AssetWriteAccess,
} from '@/lib/assets/services/asset-scope-ownership'

type AssetActionTarget = {
  readonly kind: AssetKind
  readonly assetId: string
}

type AssetMutationInput = AssetActionTarget & {
  readonly body: Record<string, unknown>
  readonly access: AssetWriteAccess
}

type AssetVariantUpdateInput = AssetMutationInput & {
  readonly variantId: string
}

type AssetCreateInput = {
  readonly kind: Extract<AssetKind, 'location' | 'prop'>
  readonly body: Record<string, unknown>
  readonly access: AssetWriteAccess
}

type AssetRemoveInput = AssetActionTarget & {
  readonly access: AssetWriteAccess
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function assertNoLegacyArtStyle(body: Record<string, unknown>): void {
  if (!Object.prototype.hasOwnProperty.call(body, 'artStyle')) return
  throw new ApiError('INVALID_PARAMS', {
    code: 'LEGACY_ART_STYLE_REMOVED',
    field: 'artStyle',
    message: 'artStyle is not an asset-record field; use an explicit Creative Direction Resource when relevant.',
  })
}

function requireLocationBackedKind(kind: AssetKind): LocationBackedAssetKind {
  if (kind !== 'location' && kind !== 'prop') throw new ApiError('INVALID_PARAMS')
  return kind
}

export async function selectAssetRender(
  input: AssetMutationInput,
  transaction: Prisma.TransactionClient,
) {
  await requireAssetBodyVariantOwnership(input, transaction)
  if (input.kind === 'character') {
    const appearanceIndex = toNumber(input.body.appearanceIndex) ?? PRIMARY_APPEARANCE_INDEX
    const imageIndex = toNumber(input.body.imageIndex)
    const confirm = input.body.confirm === true
    const appearance = await transaction.globalCharacterAppearance.findFirst({
      where: {
        characterId: input.assetId,
        appearanceIndex,
        character: { userId: input.access.userId },
      },
    })
    if (!appearance) throw new ApiError('NOT_FOUND')
    if (confirm && appearance.selectedIndex !== null) {
      const imageUrls = decodeImageUrlsFromDb(
        appearance.imageUrls,
        'globalCharacterAppearance.imageUrls',
      )
      const selectedUrl = imageUrls[appearance.selectedIndex]
      if (!selectedUrl) throw new ApiError('NOT_FOUND')
      let descriptions: string[] = []
      if (appearance.descriptions) {
        try {
          descriptions = JSON.parse(appearance.descriptions) as string[]
        } catch {
          descriptions = []
        }
      }
      const selectedDescription = descriptions[appearance.selectedIndex]
        || appearance.description
        || ''
      await transaction.globalCharacterAppearance.update({
        where: { id: appearance.id },
        data: {
          imageUrl: selectedUrl,
          imageUrls: encodeImageUrls([selectedUrl]),
          selectedIndex: 0,
          description: selectedDescription,
          descriptions: JSON.stringify([selectedDescription]),
        },
      })
    } else {
      await transaction.globalCharacterAppearance.update({
        where: { id: appearance.id },
        data: { selectedIndex: imageIndex },
      })
    }
    return { success: true }
  }

  const imageIndex = toNumber(input.body.imageIndex)
  const confirm = input.body.confirm === true
  const location = await transaction.globalLocation.findFirst({
    where: {
      id: input.assetId,
      userId: input.access.userId,
      assetKind: input.kind,
    },
    include: { images: { orderBy: { imageIndex: 'asc' } } },
  })
  if (!location) throw new ApiError('NOT_FOUND')
  const selected = location.images.find((image) => image.isSelected)
  const selectedIndex = imageIndex ?? selected?.imageIndex ?? null
  if (confirm && selectedIndex !== null) {
    const target = location.images.find((image) => image.imageIndex === selectedIndex)
    if (!target) throw new ApiError('NOT_FOUND')
    await transaction.globalLocationImage.deleteMany({
      where: { locationId: input.assetId, id: { not: target.id } },
    })
    await transaction.globalLocationImage.update({
      where: { id: target.id },
      data: { imageIndex: 0, isSelected: true },
    })
    return { success: true }
  }
  await transaction.globalLocationImage.updateMany({
    where: { locationId: input.assetId },
    data: { isSelected: false },
  })
  if (imageIndex !== null) {
    const target = location.images.find((image) => image.imageIndex === imageIndex)
    if (!target) throw new ApiError('NOT_FOUND')
    await transaction.globalLocationImage.update({
      where: { id: target.id },
      data: { isSelected: true },
    })
  }
  return { success: true }
}

export async function revertAssetRender(
  input: AssetMutationInput,
  transaction: Prisma.TransactionClient,
) {
  await requireAssetBodyVariantOwnership(input, transaction)
  if (input.kind === 'character') {
    const appearanceIndex = toNumber(input.body.appearanceIndex) ?? PRIMARY_APPEARANCE_INDEX
    const appearance = await transaction.globalCharacterAppearance.findFirst({
      where: {
        characterId: input.assetId,
        appearanceIndex,
        character: { userId: input.access.userId },
      },
    })
    if (!appearance) throw new ApiError('NOT_FOUND')
    const previousImageUrls = decodeImageUrlsFromDb(
      appearance.previousImageUrls,
      'globalCharacterAppearance.previousImageUrls',
    )
    if (!appearance.previousImageUrl && previousImageUrls.length === 0) {
      throw new ApiError('INVALID_PARAMS')
    }
    const restored = previousImageUrls.length > 0
      ? previousImageUrls
      : appearance.previousImageUrl
        ? [appearance.previousImageUrl]
        : []
    await transaction.globalCharacterAppearance.update({
      where: { id: appearance.id },
      data: {
        imageUrl: appearance.previousImageUrl || restored[0] || null,
        imageUrls: encodeImageUrls(restored),
        previousImageUrl: null,
        previousImageUrls: encodeImageUrls([]),
        selectedIndex: null,
        description: appearance.previousDescription ?? appearance.description,
        descriptions: appearance.previousDescriptions ?? appearance.descriptions,
        previousDescription: null,
        previousDescriptions: null,
      },
    })
    return { success: true }
  }
  const location = await transaction.globalLocation.findFirst({
    where: {
      id: input.assetId,
      userId: input.access.userId,
      assetKind: input.kind,
    },
    include: { images: true },
  })
  if (!location) throw new ApiError('NOT_FOUND')
  for (const image of location.images) {
    if (!image.previousImageUrl) continue
    await transaction.globalLocationImage.update({
      where: { id: image.id },
      data: {
        imageUrl: image.previousImageUrl,
        previousImageUrl: null,
        description: image.previousDescription ?? image.description,
        previousDescription: null,
      },
    })
  }
  return { success: true }
}

export async function updateAsset(
  input: AssetMutationInput,
  transaction: Prisma.TransactionClient,
) {
  await requireOwnedAssetTarget(input, transaction)
  const data: Record<string, unknown> = {}
  if (input.body.name !== undefined) data.name = normalizeString(input.body.name)
  if (input.body.folderId !== undefined) data.folderId = normalizeString(input.body.folderId) || null
  if (input.kind === 'character') {
    if (input.body.aliases !== undefined) data.aliases = input.body.aliases
    if (input.body.profileData !== undefined) data.profileData = input.body.profileData
    if (input.body.profileConfirmed !== undefined) data.profileConfirmed = input.body.profileConfirmed
    const character = await transaction.globalCharacter.update({
      where: { id: input.assetId },
      data,
    })
    return { success: true, character }
  }
  if (input.body.summary !== undefined) data.summary = normalizeString(input.body.summary) || null
  const location = await transaction.globalLocation.update({
    where: { id: input.assetId },
    data,
  })
  return input.kind === 'prop'
    ? { success: true, prop: location }
    : { success: true, location }
}

export async function updateAssetVariant(
  input: AssetVariantUpdateInput,
  transaction: Prisma.TransactionClient,
) {
  assertNoLegacyArtStyle(input.body)
  await requireOwnedAssetVariant(input, transaction)
  if (input.kind === 'character') {
    const appearance = await transaction.globalCharacterAppearance.findUnique({
      where: { id: input.variantId },
    })
    if (!appearance) throw new ApiError('NOT_FOUND')
    const data: Record<string, unknown> = {}
    if (input.body.description !== undefined) {
      const description = normalizeString(input.body.description)
      let descriptions: string[] = []
      if (appearance.descriptions) {
        try {
          descriptions = JSON.parse(appearance.descriptions) as string[]
        } catch {
          descriptions = []
        }
      }
      if (descriptions.length === 0) descriptions = [appearance.description || '']
      const index = toNumber(input.body.descriptionIndex) ?? 0
      descriptions[index] = description
      data.description = descriptions[0]
      data.descriptions = JSON.stringify(descriptions)
    }
    if (input.body.changeReason !== undefined) data.changeReason = normalizeString(input.body.changeReason)
    await transaction.globalCharacterAppearance.update({
      where: { id: input.variantId },
      data,
    })
    return { success: true }
  }
  const description = normalizeString(input.body.description)
  if (!description) throw new ApiError('INVALID_PARAMS')
  const image = await transaction.globalLocationImage.update({
    where: { id: input.variantId },
    data: { description },
  })
  return { success: true, image }
}

export async function createAsset(
  input: AssetCreateInput,
  transaction: Prisma.TransactionClient,
) {
  assertNoLegacyArtStyle(input.body)
  const name = normalizeString(input.body.name)
  const kind = requireLocationBackedKind(input.kind)
  const summary = normalizeString(input.body.summary || input.body.description)
  const description = kind === 'prop' ? normalizeString(input.body.description) : summary
  if (!name || !summary || !description) throw new ApiError('INVALID_PARAMS')
  const created = await createGlobalLocationBackedAsset({
    userId: input.access.userId,
    folderId: normalizeString(input.body.folderId) || null,
    name,
    summary,
    initialDescription: description,
    kind,
  }, transaction)
  return { success: true, assetId: created.id }
}

export async function removeAsset(
  input: AssetRemoveInput,
  transaction: Prisma.TransactionClient,
) {
  await requireOwnedAssetTarget(input, transaction)
  if (input.kind === 'character') {
    await transaction.globalCharacter.delete({ where: { id: input.assetId } })
    return { success: true }
  }
  requireLocationBackedKind(input.kind)
  await deleteGlobalLocationBackedAsset(input.assetId, transaction)
  return { success: true }
}
