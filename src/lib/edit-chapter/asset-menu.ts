import { prisma } from '@/lib/prisma'
import { decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import type { EditAssetKind } from '@/lib/edit-script/types'
import type { LocationSpatialProfileStatus } from '@/lib/location-spatial-profile/types'
import { AppError } from '@/lib/errors/app-error'
import type { ChapterPlanAssetMenu } from './schemas'

export interface ExistingAssetRef {
  readonly id: string
  readonly previewImageUrl: string | null
  readonly hasOutput: boolean
  readonly taskTargetType: 'CharacterAppearance' | 'LocationImage'
  readonly taskTargetId: string
  readonly spatialProfileJson?: unknown | null
  readonly spatialProfileStatus?: LocationSpatialProfileStatus | null
  readonly spatialProfileError?: string | null
  readonly spatialProfileAnalyzedAt?: Date | null
  readonly spatialProfileModel?: string | null
}

export interface KnownPlanAsset {
  readonly kind: EditAssetKind
  readonly id: string
  readonly name: string
  readonly description: string
  readonly asset: ExistingAssetRef
}

function normalizePlanAssetName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

export async function loadKnownPlanAssets(projectId: string): Promise<readonly KnownPlanAsset[]> {
  const characters = await prisma.projectCharacter.findMany({
    where: { projectId },
    select: {
      id: true,
      name: true,
      introduction: true,
      profileData: true,
      appearances: {
        orderBy: { appearanceIndex: 'asc' },
        take: 1,
        select: {
          id: true,
          description: true,
          imageUrl: true,
          imageMediaId: true,
          imageUrls: true,
        },
      },
    },
  })
  const locations = await prisma.projectLocation.findMany({
    where: { projectId, assetKind: 'location' },
    select: {
      id: true,
      name: true,
      summary: true,
      selectedImageId: true,
      images: {
        orderBy: { imageIndex: 'asc' },
        select: {
          id: true,
          description: true,
          imageUrl: true,
          imageMediaId: true,
          isSelected: true,
          spatialProfileJson: true,
          spatialProfileStatus: true,
          spatialProfileError: true,
          spatialProfileAnalyzedAt: true,
          spatialProfileModel: true,
        },
      },
    },
  })
  const characterAssets: KnownPlanAsset[] = characters.map((character) => {
    const appearance = character.appearances[0] ?? null
    const imageUrls = appearance ? decodeImageUrlsFromDb(appearance.imageUrls, 'editScript.planAssets.character.imageUrls') : []
    const previewImageUrl = appearance?.imageUrl || imageUrls[0] || null
    return {
      kind: 'character',
      id: character.id,
      name: normalizePlanAssetName(character.name),
      description: character.profileData?.trim()
        || character.introduction?.trim()
        || appearance?.description?.trim()
        || normalizePlanAssetName(character.name),
      asset: {
        id: character.id,
        previewImageUrl,
        hasOutput: Boolean(appearance?.imageMediaId || previewImageUrl),
        taskTargetType: 'CharacterAppearance',
        taskTargetId: appearance?.id ?? character.id,
      },
    }
  })
  const locationAssets: KnownPlanAsset[] = locations.map((location) => {
    const image = location.images.find((item) => item.id === location.selectedImageId)
      ?? location.images.find((item) => item.isSelected)
      ?? location.images.find((item) => Boolean(item.imageUrl))
      ?? location.images[0]
      ?? null
    return {
      kind: 'location',
      id: location.id,
      name: normalizePlanAssetName(location.name),
      description: location.summary?.trim()
        || image?.description?.trim()
        || normalizePlanAssetName(location.name),
      asset: {
        id: location.id,
        previewImageUrl: image?.imageUrl || null,
        hasOutput: Boolean(image?.imageMediaId || image?.imageUrl),
        taskTargetType: 'LocationImage',
        taskTargetId: location.id,
        spatialProfileJson: image?.spatialProfileJson ?? null,
        spatialProfileStatus: image?.spatialProfileStatus as LocationSpatialProfileStatus | null,
        spatialProfileError: image?.spatialProfileError ?? null,
        spatialProfileAnalyzedAt: image?.spatialProfileAnalyzedAt ?? null,
        spatialProfileModel: image?.spatialProfileModel ?? null,
      },
    }
  })
  return [...characterAssets, ...locationAssets]
}

export function buildChapterPlanAssetMenu(assets: readonly KnownPlanAsset[]): ChapterPlanAssetMenu {
  return {
    locations: assets
      .filter((asset) => asset.kind === 'location')
      .map((asset) => ({ id: asset.id, name: asset.name, description: asset.description })),
    characters: assets
      .filter((asset) => asset.kind === 'character')
      .map((asset) => ({ id: asset.id, name: asset.name, description: asset.description })),
  }
}

export function assertChapterPlanAssetMenuReady(menu: ChapterPlanAssetMenu): void {
  if (menu.locations.length > 0 && menu.characters.length > 0) return
  throw new AppError('EDIT_SCRIPT_ASSET_MENU_EMPTY', 'Confirmed location and character assets are required before chapter planning', {
    details: {
      locationCount: menu.locations.length,
      characterCount: menu.characters.length,
    },
  })
}
