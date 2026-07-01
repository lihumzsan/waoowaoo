import { prisma } from '@/lib/prisma'
import {
  assignTargetView,
  formatShotNumbers,
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

  const panelIds = idsFor(idsByType, 'ProjectPanel')
  const projectCharacterIds = idsFor(idsByType, 'ProjectCharacter')
  const characterAppearanceIds = idsFor(idsByType, 'CharacterAppearance')
  const projectLocationIds = idsFor(idsByType, 'ProjectLocation')
  const locationImageIds = idsFor(idsByType, 'LocationImage')
  const videoGroupIds = idsFor(idsByType, 'ProjectVideoGroup')
  const stylePreviewIds = idsFor(idsByType, 'ProjectEditStylePreview')
  const episodeIds = idsFor(idsByType, 'ProjectEpisode')
  const editScreenplayIds = idsFor(idsByType, 'ProjectEditScreenplay')
  const editScriptIds = idsFor(idsByType, 'ProjectEditScript')
  const editShotExecutionPlanIds = idsFor(idsByType, 'ProjectEditShotExecutionPlan')
  const projectIds = idsFor(idsByType, 'Project')
  const globalCharacterIds = idsFor(idsByType, 'GlobalCharacter')
  const globalCharacterAppearanceIds = idsFor(idsByType, 'GlobalCharacterAppearance')
  const globalLocationIds = idsFor(idsByType, 'GlobalLocation')
  const globalLocationImageIds = idsFor(idsByType, 'GlobalLocationImage')
  const [
    panels,
    projectCharacters,
    characterAppearances,
    projectLocations,
    locationImages,
    videoGroups,
    stylePreviews,
    episodes,
    editScreenplays,
    editScripts,
    editShotExecutionPlans,
    projects,
    globalCharacters,
    globalCharacterAppearances,
    globalLocations,
    globalLocationImages,
  ] = await Promise.all([
    panelIds.length > 0
      ? prisma.projectPanel.findMany({
        where: { id: { in: panelIds } },
        select: { id: true, panelNumber: true, panelIndex: true },
      })
      : Promise.resolve([]),
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
    videoGroupIds.length > 0
      ? prisma.projectVideoGroup.findMany({
        where: { id: { in: videoGroupIds } },
        select: { id: true, shotNumbers: true, durationSec: true },
      })
      : Promise.resolve([]),
    stylePreviewIds.length > 0
      ? prisma.projectEditStylePreview.findMany({
        where: { id: { in: stylePreviewIds } },
        select: { id: true, title: true, styleKey: true },
      })
      : Promise.resolve([]),
    episodeIds.length > 0
      ? prisma.projectEpisode.findMany({
        where: { id: { in: episodeIds } },
        select: { id: true, episodeNumber: true, name: true },
      })
      : Promise.resolve([]),
    editScreenplayIds.length > 0
      ? prisma.projectEditScreenplay.findMany({
        where: { id: { in: editScreenplayIds } },
        select: { id: true, episode: { select: { episodeNumber: true, name: true } } },
      })
      : Promise.resolve([]),
    editScriptIds.length > 0
      ? prisma.projectEditScript.findMany({
        where: { id: { in: editScriptIds } },
        select: { id: true, episode: { select: { episodeNumber: true, name: true } } },
      })
      : Promise.resolve([]),
    editShotExecutionPlanIds.length > 0
      ? prisma.projectEditShotExecutionPlan.findMany({
        where: { id: { in: editShotExecutionPlanIds } },
        select: { id: true, episode: { select: { episodeNumber: true, name: true } } },
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

  for (const panel of panels) {
    assignTargetView(result, refsByKey, {
      targetType: 'ProjectPanel',
      targetId: panel.id,
      labelKey: 'transactionTargets.projectPanel',
      labelParams: { number: panel.panelNumber ?? panel.panelIndex + 1 },
    })
  }

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

  for (const group of videoGroups) {
    const shots = formatShotNumbers(group.shotNumbers)
    assignTargetView(result, refsByKey, {
      targetType: 'ProjectVideoGroup',
      targetId: group.id,
      labelKey: shots ? 'transactionTargets.projectVideoGroup' : 'transactionTargets.projectVideoGroupGeneric',
      labelParams: shots ? { shots } : {},
    })
  }

  for (const preview of stylePreviews) {
    assignTargetView(result, refsByKey, {
      targetType: 'ProjectEditStylePreview',
      targetId: preview.id,
      labelKey: 'transactionTargets.projectEditStylePreview',
      labelParams: { title: preview.title || preview.styleKey },
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

  for (const screenplay of editScreenplays) {
    assignTargetView(result, refsByKey, {
      targetType: 'ProjectEditScreenplay',
      targetId: screenplay.id,
      labelKey: 'transactionTargets.projectEditScreenplay',
      labelParams: { number: screenplay.episode.episodeNumber },
    })
  }

  for (const script of editScripts) {
    assignTargetView(result, refsByKey, {
      targetType: 'ProjectEditScript',
      targetId: script.id,
      labelKey: 'transactionTargets.projectEditScript',
      labelParams: { number: script.episode.episodeNumber },
    })
  }

  for (const plan of editShotExecutionPlans) {
    assignTargetView(result, refsByKey, {
      targetType: 'ProjectEditShotExecutionPlan',
      targetId: plan.id,
      labelKey: 'transactionTargets.projectEditShotExecutionPlan',
      labelParams: { number: plan.episode.episodeNumber },
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
