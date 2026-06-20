import { Prisma } from '@prisma/client'
import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'
import { toInputJson, toNullableInputJson, mapWorkflowLabId, type WorkflowLabCloneMaps } from './clone-json'
import {
  resolveWorkflowLabEditAssetReviewStatus,
  resolveWorkflowLabScreenplayStatus,
  resolveWorkflowLabStylePreviewStatus,
  shouldWorkflowLabCloneCinematography,
  shouldWorkflowLabCloneDirectorDecoupage,
  shouldWorkflowLabCloneEditScript,
  shouldWorkflowLabCloneScreenplay,
  shouldWorkflowLabCloneStylePreviews,
  shouldWorkflowLabKeepAssetRequirementTarget,
} from './clone-stage'

export async function cloneWorkflowLabEditFirstArtifacts(params: {
  readonly tx: Prisma.TransactionClient
  readonly targetProjectId: string
  readonly sourceEpisodeId: string
  readonly targetEpisodeId: string
  readonly stage: EditFirstWorkflowStage
  readonly maps: WorkflowLabCloneMaps
}) {
  if (!shouldWorkflowLabCloneScreenplay(params.stage)) return

  const screenplay = await params.tx.projectEditScreenplay.findUnique({
    where: { episodeId: params.sourceEpisodeId },
    include: {
      stylePreviews: {
        orderBy: { createdAt: 'asc' },
      },
      directorDecoupage: true,
    },
  })

  if (screenplay) {
    const createdScreenplay = await params.tx.projectEditScreenplay.create({
      data: {
        projectId: params.targetProjectId,
        episodeId: params.targetEpisodeId,
        userPrompt: screenplay.userPrompt,
        styleBibleJson: toNullableInputJson(screenplay.styleBibleJson),
        screenplayText: screenplay.screenplayText,
        status: resolveWorkflowLabScreenplayStatus(params.stage, screenplay.status),
      },
      select: { id: true },
    })
    mapWorkflowLabId({
      maps: params.maps,
      scopedMap: params.maps.screenplayIds,
      sourceId: screenplay.id,
      targetId: createdScreenplay.id,
    })

    if (shouldWorkflowLabCloneStylePreviews(params.stage)) {
      for (const preview of screenplay.stylePreviews) {
        const createdPreview = await params.tx.projectEditStylePreview.create({
          data: {
            projectId: params.targetProjectId,
            episodeId: params.targetEpisodeId,
            editScreenplayId: createdScreenplay.id,
            styleKey: preview.styleKey,
            aspectRatio: preview.aspectRatio,
            title: preview.title,
            summary: preview.summary,
            styleBibleJson: toInputJson(preview.styleBibleJson),
            imagePrompt: preview.imagePrompt,
            imageKey: preview.imageKey,
            status: resolveWorkflowLabStylePreviewStatus(params.stage, preview.status),
            taskId: null,
            errorMessage: preview.errorMessage,
          },
          select: { id: true },
        })
        mapWorkflowLabId({
          maps: params.maps,
          scopedMap: params.maps.stylePreviewIds,
          sourceId: preview.id,
          targetId: createdPreview.id,
        })
      }
    }

    if (screenplay.directorDecoupage && shouldWorkflowLabCloneDirectorDecoupage(params.stage)) {
      const createdDirectorDecoupage = await params.tx.projectEditDirectorDecoupage.create({
        data: {
          projectId: params.targetProjectId,
          episodeId: params.targetEpisodeId,
          editScreenplayId: createdScreenplay.id,
          userPrompt: screenplay.directorDecoupage.userPrompt,
          decoupageJson: toInputJson(screenplay.directorDecoupage.decoupageJson),
          status: 'ready',
        },
        select: { id: true },
      })
      mapWorkflowLabId({
        maps: params.maps,
        scopedMap: params.maps.directorDecoupageIds,
        sourceId: screenplay.directorDecoupage.id,
        targetId: createdDirectorDecoupage.id,
      })
    }
  }

  if (!shouldWorkflowLabCloneEditScript(params.stage)) return

  const editScript = await params.tx.projectEditScript.findUnique({
    where: { episodeId: params.sourceEpisodeId },
    include: {
      requirements: {
        orderBy: { createdAt: 'asc' },
      },
      cinematographyShotPlan: true,
    },
  })

  if (!editScript) return

  const createdEditScript = await params.tx.projectEditScript.create({
    data: {
      projectId: params.targetProjectId,
      episodeId: params.targetEpisodeId,
      userPrompt: editScript.userPrompt,
      styleBibleJson: toNullableInputJson(editScript.styleBibleJson),
      screenplayText: editScript.screenplayText,
      title: editScript.title,
      logline: editScript.logline,
      durationSec: editScript.durationSec,
      shotCount: editScript.shotCount,
      status: editScript.status,
      assetReviewStatus: resolveWorkflowLabEditAssetReviewStatus(params.stage, editScript.assetReviewStatus),
      shotsJson: toInputJson(editScript.shotsJson),
      videoBlocksJson: toNullableInputJson(editScript.videoBlocksJson),
    },
    select: { id: true },
  })
  mapWorkflowLabId({
    maps: params.maps,
    scopedMap: params.maps.editScriptIds,
    sourceId: editScript.id,
    targetId: createdEditScript.id,
  })

  for (const requirement of editScript.requirements) {
    const keepTarget = shouldWorkflowLabKeepAssetRequirementTarget(params.stage)
    const mappedTargetId = keepTarget && requirement.targetId
      ? params.maps.characterIds.get(requirement.targetId)
        ?? params.maps.locationIds.get(requirement.targetId)
        ?? requirement.targetId
      : null
    const createdRequirement = await params.tx.projectEditAssetRequirement.create({
      data: {
        editScriptId: createdEditScript.id,
        projectId: params.targetProjectId,
        episodeId: params.targetEpisodeId,
        kind: requirement.kind,
        name: requirement.name,
        description: requirement.description,
        shotIndexes: toInputJson(requirement.shotIndexes),
        status: keepTarget ? requirement.status : 'pending',
        targetId: mappedTargetId,
        errorMessage: keepTarget ? requirement.errorMessage : null,
      },
      select: { id: true },
    })
    mapWorkflowLabId({
      maps: params.maps,
      scopedMap: params.maps.assetRequirementIds,
      sourceId: requirement.id,
      targetId: createdRequirement.id,
    })
  }

  if (editScript.cinematographyShotPlan && shouldWorkflowLabCloneCinematography(params.stage)) {
    const createdShotPlan = await params.tx.projectEditCinematographyShotPlan.create({
      data: {
        projectId: params.targetProjectId,
        episodeId: params.targetEpisodeId,
        editScriptId: createdEditScript.id,
        shotPlanJson: toInputJson(editScript.cinematographyShotPlan.shotPlanJson),
        status: editScript.cinematographyShotPlan.status,
      },
      select: { id: true },
    })
    mapWorkflowLabId({
      maps: params.maps,
      scopedMap: params.maps.cinematographyShotPlanIds,
      sourceId: editScript.cinematographyShotPlan.id,
      targetId: createdShotPlan.id,
    })
  }
}
