import sharp from 'sharp'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { getProjectModelConfig } from '@/lib/config-service'
import { decodeImageUrlsFromDb, encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { analyzeAndPersistProjectLocationImageSpatialProfile } from '@/lib/location-spatial-profile/service'
import { generateUniqueKey, uploadObject } from '@/lib/storage'
import type { AssetKind } from '@/lib/assets/contracts'
import type { Locale } from '@/i18n/routing'
import {
  requireOwnedAssetTarget,
  requireOwnedAssetVariant,
} from '@/lib/assets/services/asset-scope-ownership'

type ProjectUploadRenderKind = Extract<AssetKind, 'character' | 'location'>

type UploadProjectAssetRenderInput = {
  readonly userId: string
  readonly projectId: string
  readonly kind: ProjectUploadRenderKind
  readonly assetId: string
  readonly imageBuffer: Buffer
  readonly locale: Locale
  readonly appearanceId?: string
  readonly imageIndex?: number
}

type UploadProjectAssetRenderResult = {
  readonly success: true
  readonly imageKey: string
  readonly imageIndex: number
}

export async function uploadProjectAssetRender(input: UploadProjectAssetRenderInput): Promise<UploadProjectAssetRenderResult> {
  const access = {
    scope: 'project' as const,
    userId: input.userId,
    projectId: input.projectId,
  }
  if (input.kind === 'character') {
    if (!input.appearanceId) throw new ApiError('INVALID_PARAMS')
    await requireOwnedAssetVariant({
      access,
      kind: input.kind,
      assetId: input.assetId,
      variantId: input.appearanceId,
    })
  } else {
    await requireOwnedAssetTarget({
      access,
      kind: input.kind,
      assetId: input.assetId,
    })
  }

  const processed = await sharp(input.imageBuffer)
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()

  const keyPrefix = input.kind === 'character'
    ? `char-${input.assetId}-${input.appearanceId || 'unknown'}-upload`
    : `loc-${input.assetId}-upload`
  const key = generateUniqueKey(keyPrefix, 'jpg')
  await uploadObject(processed, key, undefined, 'image/jpeg')

  if (input.kind === 'character') {
    return await uploadProjectCharacterRender({
      ...input,
      appearanceId: input.appearanceId || '',
      imageKey: key,
    })
  }

  return await uploadProjectLocationRender({
    ...input,
    imageKey: key,
  })
}

async function uploadProjectCharacterRender(input: UploadProjectAssetRenderInput & {
  readonly appearanceId: string
  readonly imageKey: string
}): Promise<UploadProjectAssetRenderResult> {
  if (!input.appearanceId) throw new ApiError('INVALID_PARAMS')

  const appearance = await prisma.characterAppearance.findFirst({
    where: {
      id: input.appearanceId,
      characterId: input.assetId,
      character: { projectId: input.projectId },
    },
    select: {
      id: true,
      imageUrls: true,
      selectedIndex: true,
    },
  })
  if (!appearance) throw new ApiError('NOT_FOUND')

  const imageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'characterAppearance.imageUrls')
  const targetIndex = input.imageIndex !== undefined ? input.imageIndex : imageUrls.length
  while (imageUrls.length <= targetIndex) imageUrls.push('')
  imageUrls[targetIndex] = input.imageKey

  const selectedIndex = appearance.selectedIndex
  const shouldUpdateImageUrl =
    selectedIndex === targetIndex
    || (selectedIndex === null && targetIndex === 0)
    || imageUrls.filter((url) => !!url).length === 1

  const updateData: Record<string, unknown> = {
    imageUrls: encodeImageUrls(imageUrls),
  }
  if (shouldUpdateImageUrl) updateData.imageUrl = input.imageKey

  await prisma.characterAppearance.update({
    where: { id: appearance.id },
    data: updateData,
  })

  return { success: true, imageKey: input.imageKey, imageIndex: targetIndex }
}

async function uploadProjectLocationRender(input: UploadProjectAssetRenderInput & {
  readonly imageKey: string
}): Promise<UploadProjectAssetRenderResult> {
  const location = await prisma.projectLocation.findFirst({
    where: { id: input.assetId, projectId: input.projectId },
    include: { images: { orderBy: { imageIndex: 'asc' } } },
  })
  if (!location) throw new ApiError('NOT_FOUND')

  const targetImageIndex = input.imageIndex !== undefined ? input.imageIndex : location.images.length
  const existingImage = location.images.find((image) => image.imageIndex === targetImageIndex)
  const modelConfig = await getProjectModelConfig(input.projectId, input.userId)
  if (!modelConfig.analysisModel) throw new Error('LOCATION_SPATIAL_PROFILE_MODEL_REQUIRED')

  let imageId: string
  if (existingImage) {
    const updated = await prisma.locationImage.update({
      where: { id: existingImage.id },
      data: {
        imageUrl: input.imageKey,
        spatialProfileStatus: 'stale',
        spatialProfileError: null,
      },
      select: { id: true },
    })
    imageId = updated.id
  } else {
    const created = await prisma.locationImage.create({
      data: {
        locationId: input.assetId,
        imageIndex: targetImageIndex,
        imageUrl: input.imageKey,
        spatialProfileStatus: 'stale',
        description: null,
        isSelected: targetImageIndex === 0,
      },
      select: { id: true },
    })
    imageId = created.id
  }

  if (!location.selectedImageId) {
    await prisma.projectLocation.update({
      where: { id: input.assetId },
      data: { selectedImageId: imageId },
    })
  }

  await analyzeAndPersistProjectLocationImageSpatialProfile({
    imageId,
    userId: input.userId,
    projectId: input.projectId,
    model: modelConfig.analysisModel,
    locale: input.locale,
  })

  return { success: true, imageKey: input.imageKey, imageIndex: targetImageIndex }
}
