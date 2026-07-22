import { prisma } from '@/lib/prisma'
import {
  assignTargetView,
  groupTargetRefs,
  idsFor,
  type BillingTransactionTargetView,
  type BillingTransactionTaskContext,
} from './transaction-target-helpers'

export async function resolveBillingTransactionTargets(
  tasks: BillingTransactionTaskContext[],
): Promise<Map<string, BillingTransactionTargetView>> {
  const result = new Map<string, BillingTransactionTargetView>()
  if (tasks.length === 0) return result

  const { refsByKey, idsByType } = groupTargetRefs(tasks)

  const projectCharacterIds = idsFor(idsByType, 'ProjectCharacter')
  const characterAppearanceIds = idsFor(idsByType, 'CharacterAppearance')
  const projectLocationIds = idsFor(idsByType, 'ProjectLocation')
  const locationImageIds = idsFor(idsByType, 'LocationImage')
  const creativeResourceIds = idsFor(idsByType, 'CreativeResource')
  const episodeIds = idsFor(idsByType, 'ProjectEpisode')
  const projectIds = idsFor(idsByType, 'Project')
  const globalCharacterIds = idsFor(idsByType, 'GlobalCharacter')
  const globalCharacterAppearanceIds = idsFor(idsByType, 'GlobalCharacterAppearance')
  const globalLocationIds = idsFor(idsByType, 'GlobalLocation')
  const globalLocationImageIds = idsFor(idsByType, 'GlobalLocationImage')
  const [
    projectCharacters,
    characterAppearances,
    projectLocations,
    locationImages,
    creativeResources,
    episodes,
    projects,
    globalCharacters,
    globalCharacterAppearances,
    globalLocations,
    globalLocationImages,
  ] = await Promise.all([
    projectCharacterIds.length > 0
      ? prisma.projectCharacter.findMany({
        where: { id: { in: projectCharacterIds } },
        select: { id: true, name: true },
      })
      : Promise.resolve([]),
    characterAppearanceIds.length > 0
      ? prisma.characterAppearance.findMany({
        where: { id: { in: characterAppearanceIds } },
        select: { id: true, appearanceIndex: true, character: { select: { name: true } } },
      })
      : Promise.resolve([]),
    projectLocationIds.length > 0
      ? prisma.projectLocation.findMany({
        where: { id: { in: projectLocationIds } },
        select: { id: true, name: true },
      })
      : Promise.resolve([]),
    locationImageIds.length > 0
      ? prisma.locationImage.findMany({
        where: { id: { in: locationImageIds } },
        select: { id: true, imageIndex: true, location: { select: { name: true } } },
      })
      : Promise.resolve([]),
    creativeResourceIds.length > 0
      ? prisma.creativeResource.findMany({
        where: { id: { in: creativeResourceIds } },
        select: { id: true, name: true },
      })
      : Promise.resolve([]),
    episodeIds.length > 0
      ? prisma.projectEpisode.findMany({
        where: { id: { in: episodeIds } },
        select: { id: true, episodeNumber: true, name: true },
      })
      : Promise.resolve([]),
    projectIds.length > 0
      ? prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, name: true },
      })
      : Promise.resolve([]),
    globalCharacterIds.length > 0
      ? prisma.globalCharacter.findMany({
        where: { id: { in: globalCharacterIds } },
        select: { id: true, name: true },
      })
      : Promise.resolve([]),
    globalCharacterAppearanceIds.length > 0
      ? prisma.globalCharacterAppearance.findMany({
        where: { id: { in: globalCharacterAppearanceIds } },
        select: { id: true, appearanceIndex: true, character: { select: { name: true } } },
      })
      : Promise.resolve([]),
    globalLocationIds.length > 0
      ? prisma.globalLocation.findMany({
        where: { id: { in: globalLocationIds } },
        select: { id: true, name: true },
      })
      : Promise.resolve([]),
    globalLocationImageIds.length > 0
      ? prisma.globalLocationImage.findMany({
        where: { id: { in: globalLocationImageIds } },
        select: { id: true, imageIndex: true, location: { select: { name: true } } },
      })
      : Promise.resolve([]),
  ])

  for (const character of projectCharacters) {
    assignTargetView(result, refsByKey, {
      targetType: 'ProjectCharacter',
      targetId: character.id,
      labelKey: 'transactionTargets.projectCharacter',
      labelParams: { name: character.name },
    })
  }

  for (const appearance of characterAppearances) {
    assignTargetView(result, refsByKey, {
      targetType: 'CharacterAppearance',
      targetId: appearance.id,
      labelKey: 'transactionTargets.characterAppearance',
      labelParams: { name: appearance.character.name, index: appearance.appearanceIndex + 1 },
    })
  }

  for (const location of projectLocations) {
    assignTargetView(result, refsByKey, {
      targetType: 'ProjectLocation',
      targetId: location.id,
      labelKey: 'transactionTargets.projectLocation',
      labelParams: { name: location.name },
    })
  }

  for (const image of locationImages) {
    assignTargetView(result, refsByKey, {
      targetType: 'LocationImage',
      targetId: image.id,
      labelKey: 'transactionTargets.locationImage',
      labelParams: { name: image.location.name, index: image.imageIndex + 1 },
    })
  }

  for (const resource of creativeResources) {
    assignTargetView(result, refsByKey, {
      targetType: 'CreativeResource',
      targetId: resource.id,
      labelKey: 'transactionTargets.creativeResource',
      labelParams: { name: resource.name },
    })
  }

  for (const episode of episodes) {
    assignTargetView(result, refsByKey, {
      targetType: 'ProjectEpisode',
      targetId: episode.id,
      labelKey: 'transactionTargets.projectEpisode',
      labelParams: { number: episode.episodeNumber, name: episode.name },
    })
  }

  for (const project of projects) {
    assignTargetView(result, refsByKey, {
      targetType: 'Project',
      targetId: project.id,
      labelKey: 'transactionTargets.project',
      labelParams: { name: project.name },
    })
  }

  for (const character of globalCharacters) {
    assignTargetView(result, refsByKey, {
      targetType: 'GlobalCharacter',
      targetId: character.id,
      labelKey: 'transactionTargets.globalCharacter',
      labelParams: { name: character.name },
    })
  }

  for (const appearance of globalCharacterAppearances) {
    assignTargetView(result, refsByKey, {
      targetType: 'GlobalCharacterAppearance',
      targetId: appearance.id,
      labelKey: 'transactionTargets.globalCharacterAppearance',
      labelParams: { name: appearance.character.name, index: appearance.appearanceIndex + 1 },
    })
  }

  for (const location of globalLocations) {
    assignTargetView(result, refsByKey, {
      targetType: 'GlobalLocation',
      targetId: location.id,
      labelKey: 'transactionTargets.globalLocation',
      labelParams: { name: location.name },
    })
  }

  for (const image of globalLocationImages) {
    assignTargetView(result, refsByKey, {
      targetType: 'GlobalLocationImage',
      targetId: image.id,
      labelKey: 'transactionTargets.globalLocationImage',
      labelParams: { name: image.location.name, index: image.imageIndex + 1 },
    })
  }

  return result
}
