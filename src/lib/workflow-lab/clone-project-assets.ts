import { Prisma } from '@prisma/client'
import { mapWorkflowLabId, toNullableInputJson, type WorkflowLabCloneMaps } from './clone-json'

export async function cloneWorkflowLabProjectAssets(params: {
  readonly tx: Prisma.TransactionClient
  readonly sourceProjectId: string
  readonly targetProjectId: string
  readonly maps: WorkflowLabCloneMaps
}) {
  const characters = await params.tx.projectCharacter.findMany({
    where: { projectId: params.sourceProjectId },
    orderBy: { createdAt: 'asc' },
    include: {
      appearances: {
        orderBy: { appearanceIndex: 'asc' },
      },
    },
  })

  for (const character of characters) {
    const createdCharacter = await params.tx.projectCharacter.create({
      data: {
        projectId: params.targetProjectId,
        name: character.name,
        aliases: character.aliases,
        profileData: character.profileData,
        profileConfirmed: character.profileConfirmed,
        introduction: character.introduction,
        sourceGlobalCharacterId: character.sourceGlobalCharacterId,
      },
      select: { id: true },
    })
    mapWorkflowLabId({
      maps: params.maps,
      scopedMap: params.maps.characterIds,
      sourceId: character.id,
      targetId: createdCharacter.id,
    })

    for (const appearance of character.appearances) {
      const createdAppearance = await params.tx.characterAppearance.create({
        data: {
          characterId: createdCharacter.id,
          appearanceIndex: appearance.appearanceIndex,
          changeReason: appearance.changeReason,
          description: appearance.description,
          descriptions: appearance.descriptions,
          imageUrl: appearance.imageUrl,
          imageUrls: appearance.imageUrls,
          selectedIndex: appearance.selectedIndex,
          previousImageUrl: appearance.previousImageUrl,
          previousImageUrls: appearance.previousImageUrls,
          previousDescription: appearance.previousDescription,
          previousDescriptions: appearance.previousDescriptions,
          imageMediaId: appearance.imageMediaId,
        },
        select: { id: true },
      })
      mapWorkflowLabId({
        maps: params.maps,
        scopedMap: params.maps.characterAppearanceIds,
        sourceId: appearance.id,
        targetId: createdAppearance.id,
      })
    }
  }

  const locations = await params.tx.projectLocation.findMany({
    where: { projectId: params.sourceProjectId },
    orderBy: { createdAt: 'asc' },
    include: {
      images: {
        orderBy: { imageIndex: 'asc' },
      },
    },
  })

  for (const location of locations) {
    const createdLocation = await params.tx.projectLocation.create({
      data: {
        projectId: params.targetProjectId,
        name: location.name,
        summary: location.summary,
        assetKind: location.assetKind,
        sourceGlobalLocationId: location.sourceGlobalLocationId,
      },
      select: { id: true },
    })
    mapWorkflowLabId({
      maps: params.maps,
      scopedMap: params.maps.locationIds,
      sourceId: location.id,
      targetId: createdLocation.id,
    })

    for (const image of location.images) {
      const createdImage = await params.tx.locationImage.create({
        data: {
          locationId: createdLocation.id,
          imageIndex: image.imageIndex,
          description: image.description,
          imageUrl: image.imageUrl,
          spatialProfileJson: toNullableInputJson(image.spatialProfileJson),
          spatialProfileStatus: image.spatialProfileStatus,
          spatialProfileError: image.spatialProfileError,
          spatialProfileAnalyzedAt: image.spatialProfileAnalyzedAt,
          spatialProfileModel: image.spatialProfileModel,
          isSelected: image.isSelected,
          previousImageUrl: image.previousImageUrl,
          previousDescription: image.previousDescription,
          imageMediaId: image.imageMediaId,
        },
        select: { id: true },
      })
      mapWorkflowLabId({
        maps: params.maps,
        scopedMap: params.maps.locationImageIds,
        sourceId: image.id,
        targetId: createdImage.id,
      })
    }

    const mappedSelectedImageId = location.selectedImageId
      ? params.maps.locationImageIds.get(location.selectedImageId) ?? null
      : null
    if (mappedSelectedImageId) {
      await params.tx.projectLocation.update({
        where: { id: createdLocation.id },
        data: { selectedImageId: mappedSelectedImageId },
      })
    }
  }
}
