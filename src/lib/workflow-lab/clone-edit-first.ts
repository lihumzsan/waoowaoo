import { Prisma } from '@prisma/client'
import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'
import { DEFAULT_EDIT_CHAPTER_INDEX } from '@/lib/edit-chapter'
import { toInputJson, toNullableInputJson, mapWorkflowLabId, type WorkflowLabCloneMaps } from './clone-json'
import {
  resolveWorkflowLabEditAssetReviewStatus,
  resolveWorkflowLabBibleStatus,
  resolveWorkflowLabStylePreviewStatus,
  shouldWorkflowLabCloneEditScript,
  shouldWorkflowLabCloneBible,
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
  if (!shouldWorkflowLabCloneBible(params.stage)) return

  const bible = await params.tx.projectEditBible.findUnique({
    where: { episodeId: params.sourceEpisodeId },
    include: {
      sourceDocument: true,
      stylePreviews: {
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (bible) {
    const targetSourceDocument = await params.tx.projectEpisodeSourceDocument.create({
      data: {
        episodeId: params.targetEpisodeId,
        normalizedText: bible.sourceDocument.normalizedText,
        checksum: bible.sourceDocument.checksum,
        sourceKind: bible.sourceDocument.sourceKind,
        rawFileMediaId: bible.sourceDocument.rawFileMediaId,
        version: bible.sourceDocument.version,
      },
      select: { id: true },
    })
    const createdBible = await params.tx.projectEditBible.create({
      data: {
        episodeId: params.targetEpisodeId,
        sourceDocumentId: targetSourceDocument.id,
        bibleJson: toNullableInputJson(bible.bibleJson),
        beatSheetJson: toNullableInputJson(bible.beatSheetJson),
        ledgerJson: toNullableInputJson(bible.ledgerJson),
        emotionalCurveJson: toNullableInputJson(bible.emotionalCurveJson),
        styleBibleJson: toNullableInputJson(bible.styleBibleJson),
        diagnosticsJson: toNullableInputJson(bible.diagnosticsJson),
        version: bible.version,
        status: resolveWorkflowLabBibleStatus(params.stage, bible.status),
        lockedAt: bible.lockedAt,
      },
      select: { id: true },
    })
    mapWorkflowLabId({
      maps: params.maps,
      scopedMap: params.maps.bibleIds,
      sourceId: bible.id,
      targetId: createdBible.id,
    })

    if (shouldWorkflowLabCloneStylePreviews(params.stage)) {
      for (const preview of bible.stylePreviews) {
        const createdPreview = await params.tx.projectEditStylePreview.create({
          data: {
            projectId: params.targetProjectId,
            episodeId: params.targetEpisodeId,
            editBibleId: createdBible.id,
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
  const [sourceChapter, targetChapter] = await Promise.all([
    params.tx.projectEditChapter.findUnique({
      where: { episodeId_chapterIndex: { episodeId: params.sourceEpisodeId, chapterIndex: DEFAULT_EDIT_CHAPTER_INDEX } },
      select: { id: true },
    }),
    params.tx.projectEditChapter.findUnique({
      where: { episodeId_chapterIndex: { episodeId: params.targetEpisodeId, chapterIndex: DEFAULT_EDIT_CHAPTER_INDEX } },
      select: { id: true },
    }),
  ])
  if (!sourceChapter || !targetChapter) throw new Error('WORKFLOW_LAB_DEFAULT_EDIT_CHAPTER_REQUIRED')

  const editScript = await params.tx.projectEditScript.findUnique({
    where: { chapterId: sourceChapter.id },
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
      chapterId: targetChapter.id,
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
        chapterId: targetChapter.id,
        kind: requirement.kind,
        name: requirement.name,
        description: requirement.description,
        requiredForShotIds: toInputJson(requirement.requiredForShotIds),
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
        chapterId: targetChapter.id,
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
