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

  const workspaceResourceIds = idsFor(idsByType, 'WorkspaceResource')
  const projectIds = idsFor(idsByType, 'Project')
  const globalCharacterIds = idsFor(idsByType, 'GlobalCharacter')
  const globalCharacterAppearanceIds = idsFor(idsByType, 'GlobalCharacterAppearance')
  const globalLocationIds = idsFor(idsByType, 'GlobalLocation')
  const globalLocationImageIds = idsFor(idsByType, 'GlobalLocationImage')
  const [
    workspaceResources,
    projects,
    globalCharacters,
    globalCharacterAppearances,
    globalLocations,
    globalLocationImages,
  ] = await Promise.all([
    workspaceResourceIds.length > 0
      ? prisma.workspaceResource.findMany({
        where: { id: { in: workspaceResourceIds } },
        select: { id: true, name: true },
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

  for (const resource of workspaceResources) {
    assignTargetView(result, refsByKey, {
      targetType: 'WorkspaceResource',
      targetId: resource.id,
      labelKey: 'transactionTargets.workspaceResource',
      labelParams: { name: resource.name },
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
