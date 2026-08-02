import {
  createIdleTaskState,
  type AssetRenderSummary,
  type AssetSummary,
  type AssetVariantSummary,
  type CharacterAssetSummary,
  type LocationAssetSummary,
  type PropAssetSummary,
} from '@/lib/assets/contracts'
import { getAssetKindRegistration } from '@/lib/assets/kinds/registry'
import type { MediaRef } from '@/types/project'

type GlobalCharacterRecord = {
  id: string
  name: string
  folderId: string | null
  appearances: Array<{
    id: string
    appearanceIndex: number
    changeReason: string
    description: string | null
    imageUrl: string | null
    media?: MediaRef | null
    imageUrls: string[]
    imageMedias?: MediaRef[]
    selectedIndex: number | null
    previousImageUrl: string | null
    previousMedia?: MediaRef | null
    previousImageUrls: string[]
    previousImageMedias?: MediaRef[]
  }>
}

type LocationImageRecord = {
  id: string
  imageIndex: number
  description: string | null
  imageUrl: string | null
  media?: MediaRef | null
  previousImageUrl: string | null
  previousMedia?: MediaRef | null
  isSelected: boolean
}

type GlobalLocationRecord = {
  id: string
  name: string
  summary: string | null
  folderId: string | null
  images: LocationImageRecord[]
}

type GlobalPropRecord = {
  id: string
  name: string
  summary: string | null
  folderId: string | null
  images: LocationImageRecord[]
}

function createRender(params: {
  id: string
  index: number
  imageUrl: string | null
  media: MediaRef | null
  isSelected: boolean
  previousImageUrl: string | null
  previousMedia: MediaRef | null
}): AssetRenderSummary {
  return {
    ...params,
    taskRefs: [],
    taskState: createIdleTaskState(),
  }
}

function createVariant(params: {
  id: string
  index: number
  label: string
  description: string | null
  selectedRenderIndex: number | null
  renders: AssetRenderSummary[]
}): AssetVariantSummary {
  return {
    id: params.id,
    index: params.index,
    label: params.label,
    description: params.description,
    renders: params.renders,
    selectionState: {
      selectedRenderIndex: params.selectedRenderIndex,
    },
    taskRefs: [],
    taskState: createIdleTaskState(),
  }
}

export function mapGlobalCharacterToAsset(character: GlobalCharacterRecord): CharacterAssetSummary {
  const registration = getAssetKindRegistration('character')
  const variants = character.appearances.map((appearance) => {
    const imageMedias = appearance.imageMedias ?? []
    const previousImageMedias = appearance.previousImageMedias ?? []
    const renders = appearance.imageUrls.map((imageUrl, renderIndex) =>
      createRender({
        id: `${appearance.id}:${renderIndex}`,
        index: renderIndex,
        imageUrl,
        media: imageMedias[renderIndex] ?? null,
        isSelected: appearance.selectedIndex === renderIndex,
        previousImageUrl: appearance.previousImageUrls[renderIndex] ?? appearance.previousImageUrl ?? null,
        previousMedia: previousImageMedias[renderIndex] ?? appearance.previousMedia ?? null,
      }),
    )
    return createVariant({
      id: appearance.id,
      index: appearance.appearanceIndex,
      label: appearance.changeReason,
      description: appearance.description,
      selectedRenderIndex: appearance.selectedIndex,
      renders,
    })
  })

  return {
    id: character.id,
    scope: 'global',
    kind: 'character',
    family: 'visual',
    name: character.name,
    folderId: character.folderId,
    capabilities: registration.capabilities,
    taskRefs: [],
    taskState: createIdleTaskState(),
    variants,
    introduction: null,
    profileData: null,
    profileConfirmed: null,
  }
}

function buildLocationVariants(
  images: LocationImageRecord[],
): AssetVariantSummary[] {
  return images.map((image) => {
    return createVariant({
      id: image.id,
      index: image.imageIndex,
      label: `Image ${image.imageIndex + 1}`,
      description: image.description,
      selectedRenderIndex: image.isSelected ? 0 : null,
      renders: [
        createRender({
          id: image.id,
          index: 0,
          imageUrl: image.imageUrl,
          media: image.media ?? null,
          isSelected: image.isSelected,
          previousImageUrl: image.previousImageUrl,
          previousMedia: image.previousMedia ?? null,
        }),
      ],
    })
  })
}

function mapLocationLikeGlobalAsset(
  kind: 'location' | 'prop',
  asset: GlobalLocationRecord | GlobalPropRecord,
): LocationAssetSummary | PropAssetSummary {
  const registration = getAssetKindRegistration(kind)
  const variants = buildLocationVariants(asset.images)
  const selectedVariant = variants.find((variant) => variant.renders[0]?.isSelected)
  return {
    id: asset.id,
    scope: 'global',
    kind,
    family: 'visual',
    name: asset.name,
    folderId: asset.folderId,
    capabilities: registration.capabilities,
    taskRefs: [],
    taskState: createIdleTaskState(),
    variants,
    summary: asset.summary,
    selectedVariantId: selectedVariant?.id ?? null,
  }
}

export function mapGlobalLocationToAsset(location: GlobalLocationRecord): LocationAssetSummary {
  return mapLocationLikeGlobalAsset('location', location) as LocationAssetSummary
}

export function mapGlobalPropToAsset(prop: GlobalPropRecord): PropAssetSummary {
  return mapLocationLikeGlobalAsset('prop', prop) as PropAssetSummary
}

export function filterAssetsByKind(
  assets: AssetSummary[],
  kind: AssetSummary['kind'] | null | undefined,
): AssetSummary[] {
  if (!kind) return assets
  return assets.filter((asset) => asset.kind === kind)
}
