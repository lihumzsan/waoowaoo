import { prisma } from '@/lib/prisma'
import { attachMediaFieldsToGlobalCharacter, attachMediaFieldsToGlobalLocation } from '@/lib/media/attach'
import {
  filterAssetsByKind as filterMappedAssetsByKind,
  mapGlobalCharacterToAsset,
  mapGlobalLocationToAsset,
  mapGlobalPropToAsset,
} from '@/lib/assets/mappers'
import type { AssetKind, AssetQueryInput, AssetSummary } from '@/lib/assets/contracts'
import {
  listGlobalLocationBackedAssets,
} from '@/lib/assets/services/location-backed-assets'

async function readGlobalAssets(input: { folderId?: string | null; userId: string }): Promise<AssetSummary[]> {
  const folderFilter = input.folderId ? { folderId: input.folderId } : {}
  const where = {
    userId: input.userId,
    ...folderFilter,
  }
  const [characters, locations, props] = await Promise.all([
    prisma.globalCharacter.findMany({
      where,
      include: {
        appearances: {
          orderBy: { appearanceIndex: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    listGlobalLocationBackedAssets({
      userId: input.userId,
      folderId: input.folderId,
      kind: 'location',
    }),
    listGlobalLocationBackedAssets({
      userId: input.userId,
      folderId: input.folderId,
      kind: 'prop',
    }),
  ])

  const [globalCharacters, globalLocations, globalProps] = await Promise.all([
    Promise.all(characters.map((character) => attachMediaFieldsToGlobalCharacter(character))),
    Promise.all(locations.map((location) => attachMediaFieldsToGlobalLocation(location))),
    Promise.all(props.map((prop) => attachMediaFieldsToGlobalLocation(prop))),
  ])

  return [
    ...(globalCharacters as unknown as Parameters<typeof mapGlobalCharacterToAsset>[0][]).map(mapGlobalCharacterToAsset),
    ...(globalLocations as unknown as Parameters<typeof mapGlobalLocationToAsset>[0][]).map(mapGlobalLocationToAsset),
    ...(globalProps as unknown as Parameters<typeof mapGlobalPropToAsset>[0][]).map(mapGlobalPropToAsset),
  ]
}

export async function readAssets(
  input: AssetQueryInput,
  access?: { userId?: string | null },
): Promise<AssetSummary[]> {
  const assets = await readGlobalAssets({
    folderId: input.folderId,
    userId: assertUserId(access?.userId),
  })
  return filterMappedAssetsByKind(assets, input.kind as AssetKind | null | undefined)
}

function assertUserId(userId: string | null | undefined): string {
  if (!userId) {
    throw new Error('userId is required for global asset scope')
  }
  return userId
}
