import { Prisma } from '@prisma/client'
import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'
import { toInputJson, toNullableInputJson, mapWorkflowLabId, readMappedId, type WorkflowLabCloneMaps } from './clone-json'
import {
  resolveWorkflowLabEditAssetReviewStatus,
  resolveWorkflowLabScreenplayStatus,
  resolveWorkflowLabStylePreviewStatus,
  shouldWorkflowLabCloneEditScript,
  shouldWorkflowLabCloneScreenplay,
  shouldWorkflowLabCloneShotExecutionPlan,
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

  }

  if (!shouldWorkflowLabCloneEditScript(params.stage)) return

  const editScript = await params.tx.projectEditScript.findUnique({
    where: { episodeId: params.sourceEpisodeId },
    include: {
      requirements: {
        orderBy: { createdAt: 'asc' },
      },
      shotExecutionPlan: true,
    },
  })

  if (!editScript) return

  const createdEditScript = await params.tx.projectEditScript.create({
    data: {
      projectId: params.targetProjectId,
      episodeId: params.targetEpisodeId,
      editScreenplayId: readMappedId(params.maps.screenplayIds, editScript.editScreenplayId),
      corePlanJson: toNullableInputJson(editScript.corePlanJson),
      durationSec: editScript.durationSec,
      shotCount: editScript.shotCount,
      status: editScript.status,
      assetReviewStatus: resolveWorkflowLabEditAssetReviewStatus(params.stage, editScript.assetReviewStatus),
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
        requiredForShotNumbers: toInputJson(requirement.requiredForShotNumbers),
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

  if (editScript.shotExecutionPlan && shouldWorkflowLabCloneShotExecutionPlan(params.stage)) {
    const createdShotPlan = await params.tx.projectEditShotExecutionPlan.create({
      data: {
        projectId: params.targetProjectId,
        episodeId: params.targetEpisodeId,
        editScriptId: createdEditScript.id,
        executionPlanJson: toInputJson(editScript.shotExecutionPlan.executionPlanJson),
        status: editScript.shotExecutionPlan.status,
      },
      select: { id: true },
    })
    mapWorkflowLabId({
      maps: params.maps,
      scopedMap: params.maps.shotExecutionPlanIds,
      sourceId: editScript.shotExecutionPlan.id,
      targetId: createdShotPlan.id,
    })
  }
}
