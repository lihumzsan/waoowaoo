import sharp from 'sharp'
import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { getProjectModelConfig } from '@/lib/config-service'
import { decodeImageUrlsFromDb, encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import {
  analyzeLocationSpatialProfile,
  locationSpatialProfileToJson,
} from '@/lib/location-spatial-profile/service'
import { parseLocationSpatialProfile, type LocationSpatialProfile } from '@/lib/location-spatial-profile/types'
import { prisma } from '@/lib/prisma'
import { deleteObject, generateUniqueKey, uploadObject } from '@/lib/storage'
import type { AssetKind } from '@/lib/assets/contracts'
import type { Locale } from '@/i18n/routing'
import {
  requireOwnedAssetTarget,
  requireOwnedAssetVariant,
} from '@/lib/assets/services/asset-scope-ownership'

type ProjectUploadRenderKind = Extract<AssetKind, 'character' | 'location'>

export type UploadProjectAssetRenderInput = {
  readonly userId: string
  readonly projectId: string
  readonly kind: ProjectUploadRenderKind
  readonly assetId: string
  readonly imageBuffer: Buffer
  readonly locale: Locale
  readonly appearanceId?: string
  readonly imageIndex?: number
}

export type ProjectAssetRenderTargetInput = Omit<
  UploadProjectAssetRenderInput,
  'imageBuffer' | 'locale'
>

export type UploadProjectAssetRenderResult = {
  readonly success: true
  readonly imageKey: string
  readonly imageIndex: number
}

type PreparedProjectCharacterRender = {
  readonly kind: 'character'
  readonly imageKey: string
  readonly appearanceId: string
  readonly appearanceUpdatedAtMs: number
}

type PreparedProjectLocationRender = {
  readonly kind: 'location'
  readonly imageKey: string
  readonly imageIndex: number
  readonly existingImageId: string | null
  readonly existingImageUpdatedAtMs: number | null
  readonly locationUpdatedAtMs: number
  readonly profile: LocationSpatialProfile
  readonly profileModel: string
}

export type PreparedProjectAssetRender =
  | PreparedProjectCharacterRender
  | PreparedProjectLocationRender

function accessFor(input: ProjectAssetRenderTargetInput) {
  return {
    scope: 'project' as const,
    userId: input.userId,
    projectId: input.projectId,
  }
}

async function requireUploadTarget(input: UploadProjectAssetRenderInput): Promise<void> {
  if (input.kind === 'character') {
    if (!input.appearanceId) throw new ApiError('INVALID_PARAMS')
    await requireOwnedAssetVariant({
      access: accessFor(input),
      kind: input.kind,
      assetId: input.assetId,
      variantId: input.appearanceId,
    })
    return
  }
  await requireOwnedAssetTarget({
    access: accessFor(input),
    kind: input.kind,
    assetId: input.assetId,
  })
}

async function deletePreparedImageOrThrow(imageKey: string, cause: unknown, label: string): Promise<never> {
  try {
    await deleteObject(imageKey)
  } catch (cleanupError) {
    throw new AggregateError([cause, cleanupError], `${label}:${imageKey}`)
  }
  throw cause
}

export async function prepareProjectAssetRenderUpload(
  input: UploadProjectAssetRenderInput,
): Promise<PreparedProjectAssetRender> {
  await requireUploadTarget(input)

  const appearance = input.kind === 'character' && input.appearanceId
    ? await prisma.characterAppearance.findFirst({
        where: {
          id: input.appearanceId,
          characterId: input.assetId,
          character: {
            projectId: input.projectId,
            project: { userId: input.userId },
          },
        },
        select: { updatedAt: true },
      })
    : null
  if (input.kind === 'character' && !appearance) throw new ApiError('NOT_FOUND')

  const location = input.kind === 'location'
    ? await prisma.projectLocation.findFirst({
        where: {
          id: input.assetId,
          projectId: input.projectId,
          project: { userId: input.userId },
        },
        select: {
          name: true,
          updatedAt: true,
          images: {
            orderBy: { imageIndex: 'asc' },
            select: {
              id: true,
              imageIndex: true,
              description: true,
              updatedAt: true,
            },
          },
        },
      })
    : null
  if (input.kind === 'location' && !location) throw new ApiError('NOT_FOUND')

  const analysisModel = input.kind === 'location'
    ? (await getProjectModelConfig(input.projectId, input.userId)).analysisModel
    : null
  if (input.kind === 'location' && !analysisModel) {
    throw new Error('LOCATION_SPATIAL_PROFILE_MODEL_REQUIRED')
  }

  const processed = await sharp(input.imageBuffer)
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()
  const keyPrefix = input.kind === 'character'
    ? `char-${input.assetId}-${input.appearanceId || 'unknown'}-upload`
    : `loc-${input.assetId}-upload`
  const imageKey = generateUniqueKey(keyPrefix, 'jpg')
  try {
    await uploadObject(processed, imageKey, undefined, 'image/jpeg')
    if (input.kind === 'character') {
      if (!appearance) throw new Error('PROJECT_CHARACTER_UPLOAD_PREPARE_INVALID')
      return {
        kind: input.kind,
        imageKey,
        appearanceId: input.appearanceId || '',
        appearanceUpdatedAtMs: appearance.updatedAt.getTime(),
      }
    }
    if (!location || !analysisModel) throw new Error('PROJECT_LOCATION_UPLOAD_PREPARE_INVALID')
    const imageIndex = input.imageIndex ?? location.images.length
    const existingImage = location.images.find((image) => image.imageIndex === imageIndex) ?? null
    const profile = await analyzeLocationSpatialProfile({
      userId: input.userId,
      projectId: input.projectId,
      model: analysisModel,
      locale: input.locale,
      locationName: location.name,
      locationDescription: existingImage?.description ?? null,
      imageUrl: imageKey,
    })
    return {
      kind: input.kind,
      imageKey,
      imageIndex,
      existingImageId: existingImage?.id ?? null,
      existingImageUpdatedAtMs: existingImage?.updatedAt.getTime() ?? null,
      locationUpdatedAtMs: location.updatedAt.getTime(),
      profile,
      profileModel: analysisModel,
    }
  } catch (error) {
    return await deletePreparedImageOrThrow(
      imageKey,
      error,
      'PROJECT_ASSET_UPLOAD_PREPARE_COMPENSATION_FAILED',
    )
  }
}

export function parsePreparedProjectAssetRender(value: unknown): PreparedProjectAssetRender {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('PROJECT_ASSET_UPLOAD_PREPARED_INVALID')
  }
  const candidate = value as Record<string, unknown>
  const imageKey = typeof candidate.imageKey === 'string' ? candidate.imageKey.trim() : ''
  const existingImageId = typeof candidate.existingImageId === 'string'
    ? candidate.existingImageId.trim()
    : candidate.existingImageId
  if (!imageKey) throw new Error('PROJECT_ASSET_UPLOAD_PREPARED_INVALID')
  if (candidate.kind === 'character') {
    const appearanceId = typeof candidate.appearanceId === 'string' ? candidate.appearanceId.trim() : ''
    if (
      !appearanceId
      || typeof candidate.appearanceUpdatedAtMs !== 'number'
      || !Number.isFinite(candidate.appearanceUpdatedAtMs)
      || candidate.appearanceUpdatedAtMs < 0
    ) {
      throw new Error('PROJECT_ASSET_UPLOAD_PREPARED_INVALID')
    }
    return {
      kind: candidate.kind,
      imageKey,
      appearanceId,
      appearanceUpdatedAtMs: candidate.appearanceUpdatedAtMs,
    }
  }
  if (
    candidate.kind !== 'location'
    || typeof candidate.imageIndex !== 'number'
    || !Number.isInteger(candidate.imageIndex)
    || candidate.imageIndex < 0
    || (existingImageId !== null && (typeof existingImageId !== 'string' || !existingImageId))
    || (
      candidate.existingImageUpdatedAtMs !== null
      && (
        typeof candidate.existingImageUpdatedAtMs !== 'number'
        || !Number.isFinite(candidate.existingImageUpdatedAtMs)
      )
    )
    || ((existingImageId === null) !== (candidate.existingImageUpdatedAtMs === null))
    || typeof candidate.locationUpdatedAtMs !== 'number'
    || !Number.isFinite(candidate.locationUpdatedAtMs)
    || typeof candidate.profileModel !== 'string'
    || !candidate.profileModel.trim()
  ) {
    throw new Error('PROJECT_ASSET_UPLOAD_PREPARED_INVALID')
  }
  return {
    kind: candidate.kind,
    imageKey,
    imageIndex: candidate.imageIndex,
    existingImageId,
    existingImageUpdatedAtMs: candidate.existingImageUpdatedAtMs,
    locationUpdatedAtMs: candidate.locationUpdatedAtMs,
    profile: parseLocationSpatialProfile(candidate.profile),
    profileModel: candidate.profileModel.trim(),
  }
}

export async function compensatePreparedProjectAssetRenderUpload(
  input: ProjectAssetRenderTargetInput,
  preparedValue: unknown,
): Promise<void> {
  const prepared = parsePreparedProjectAssetRender(preparedValue)
  if (prepared.kind !== input.kind) throw new Error('PROJECT_ASSET_UPLOAD_PREPARED_KIND_MISMATCH')
  const committedRelation = prepared.kind === 'character'
    ? await prisma.characterAppearance.findFirst({
        where: {
          id: prepared.appearanceId,
          characterId: input.assetId,
          character: { projectId: input.projectId, project: { userId: input.userId } },
          OR: [
            { imageUrl: prepared.imageKey },
            { imageUrls: { contains: prepared.imageKey } },
          ],
        },
        select: { id: true },
      })
    : await prisma.locationImage.findFirst({
        where: {
          locationId: input.assetId,
          imageIndex: prepared.imageIndex,
          imageUrl: prepared.imageKey,
          location: { projectId: input.projectId, project: { userId: input.userId } },
        },
        select: { id: true },
      })
  if (committedRelation) {
    return
  }
  await deleteObject(prepared.imageKey)
}

export async function commitProjectAssetRenderUpload(
  input: ProjectAssetRenderTargetInput,
  preparedValue: unknown,
  transaction: Prisma.TransactionClient,
): Promise<UploadProjectAssetRenderResult> {
  const prepared = parsePreparedProjectAssetRender(preparedValue)
  if (prepared.kind === 'character') {
    if (input.kind !== prepared.kind) throw new Error('PROJECT_ASSET_UPLOAD_PREPARED_KIND_MISMATCH')
    if (!input.appearanceId || prepared.appearanceId !== input.appearanceId) {
      throw new Error('PROJECT_ASSET_UPLOAD_PREPARED_TARGET_MISMATCH')
    }
    await requireOwnedAssetVariant({
      access: accessFor(input),
      kind: input.kind,
      assetId: input.assetId,
      variantId: input.appearanceId,
    }, transaction)
    return await commitProjectCharacterRender(input, prepared, transaction)
  }

  if (input.kind !== prepared.kind) throw new Error('PROJECT_ASSET_UPLOAD_PREPARED_KIND_MISMATCH')
  await requireOwnedAssetTarget({
    access: accessFor(input),
    kind: input.kind,
    assetId: input.assetId,
  }, transaction)
  return await commitProjectLocationRender(input, prepared, transaction)
}

async function commitProjectCharacterRender(
  input: ProjectAssetRenderTargetInput,
  prepared: PreparedProjectCharacterRender,
  transaction: Prisma.TransactionClient,
): Promise<UploadProjectAssetRenderResult> {
  const appearance = await transaction.characterAppearance.findFirst({
    where: {
      id: prepared.appearanceId,
      characterId: input.assetId,
      character: { projectId: input.projectId },
      updatedAt: new Date(prepared.appearanceUpdatedAtMs),
    },
    select: {
      id: true,
      imageUrls: true,
      selectedIndex: true,
    },
  })
  if (!appearance) throw new Error('PROJECT_CHARACTER_APPEARANCE_CHANGED_DURING_UPLOAD')

  const imageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'characterAppearance.imageUrls')
  const targetIndex = input.imageIndex !== undefined ? input.imageIndex : imageUrls.length
  while (imageUrls.length <= targetIndex) imageUrls.push('')
  imageUrls[targetIndex] = prepared.imageKey

  const selectedIndex = appearance.selectedIndex
  const shouldUpdateImageUrl =
    selectedIndex === targetIndex
    || (selectedIndex === null && targetIndex === 0)
    || imageUrls.filter((url) => !!url).length === 1

  const updateData: Record<string, unknown> = {
    imageUrls: encodeImageUrls(imageUrls),
  }
  if (shouldUpdateImageUrl) updateData.imageUrl = prepared.imageKey

  updateData.updatedAt = new Date(Math.max(Date.now(), prepared.appearanceUpdatedAtMs + 1))
  const updated = await transaction.characterAppearance.updateMany({
    where: {
      id: appearance.id,
      updatedAt: new Date(prepared.appearanceUpdatedAtMs),
    },
    data: updateData,
  })
  if (updated.count !== 1) throw new Error('PROJECT_CHARACTER_APPEARANCE_CHANGED_DURING_UPLOAD')

  return { success: true, imageKey: prepared.imageKey, imageIndex: targetIndex }
}

async function commitProjectLocationRender(
  input: ProjectAssetRenderTargetInput,
  prepared: PreparedProjectLocationRender,
  transaction: Prisma.TransactionClient,
): Promise<UploadProjectAssetRenderResult> {
  const location = await transaction.projectLocation.findFirst({
    where: {
      id: input.assetId,
      projectId: input.projectId,
      updatedAt: new Date(prepared.locationUpdatedAtMs),
    },
    select: { id: true, selectedImageId: true },
  })
  if (!location) throw new Error('PROJECT_LOCATION_CHANGED_DURING_UPLOAD')
  if (input.imageIndex !== undefined && input.imageIndex !== prepared.imageIndex) {
    throw new Error('PROJECT_ASSET_UPLOAD_PREPARED_TARGET_MISMATCH')
  }

  let imageId: string
  if (prepared.existingImageId) {
    const existingImage = await transaction.locationImage.findFirst({
      where: {
        id: prepared.existingImageId,
        locationId: input.assetId,
        imageIndex: prepared.imageIndex,
        updatedAt: new Date(prepared.existingImageUpdatedAtMs ?? -1),
      },
      select: { id: true },
    })
    if (!existingImage) throw new Error('PROJECT_LOCATION_IMAGE_CHANGED_DURING_UPLOAD')
    const updated = await transaction.locationImage.updateMany({
      where: {
        id: existingImage.id,
        updatedAt: new Date(prepared.existingImageUpdatedAtMs ?? -1),
      },
      data: {
        imageUrl: prepared.imageKey,
        spatialProfileJson: locationSpatialProfileToJson(prepared.profile),
        spatialProfileStatus: 'ready',
        spatialProfileError: null,
        spatialProfileAnalyzedAt: new Date(),
        spatialProfileModel: prepared.profileModel,
        updatedAt: new Date(Math.max(Date.now(), (prepared.existingImageUpdatedAtMs ?? 0) + 1)),
      },
    })
    if (updated.count !== 1) throw new Error('PROJECT_LOCATION_IMAGE_CHANGED_DURING_UPLOAD')
    imageId = existingImage.id
  } else {
    const conflictingImage = await transaction.locationImage.findFirst({
      where: { locationId: input.assetId, imageIndex: prepared.imageIndex },
      select: { id: true },
    })
    if (conflictingImage) throw new Error('PROJECT_LOCATION_IMAGE_CHANGED_DURING_UPLOAD')
    const created = await transaction.locationImage.create({
      data: {
        locationId: input.assetId,
        imageIndex: prepared.imageIndex,
        imageUrl: prepared.imageKey,
        spatialProfileJson: locationSpatialProfileToJson(prepared.profile),
        spatialProfileStatus: 'ready',
        spatialProfileError: null,
        spatialProfileAnalyzedAt: new Date(),
        spatialProfileModel: prepared.profileModel,
        description: null,
        isSelected: prepared.imageIndex === 0,
      },
      select: { id: true },
    })
    imageId = created.id
  }

  if (!location.selectedImageId) {
    await transaction.projectLocation.update({
      where: { id: input.assetId },
      data: { selectedImageId: imageId },
    })
  }

  return { success: true, imageKey: prepared.imageKey, imageIndex: prepared.imageIndex }
}
