import { Prisma } from '@prisma/client'
import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'
import {
  mapWorkflowLabId,
  readMappedId,
  toInputJson,
  toNullableInputJson,
  type WorkflowLabCloneMaps,
} from './clone-json'
import { rewriteWorkflowLabValue } from './message-rewrite'
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

async function cloneWorkflowLabChapters(params: {
  readonly tx: Prisma.TransactionClient
  readonly sourceEpisodeId: string
  readonly targetEpisodeId: string
  readonly sourceDocumentId: string
  readonly targetSourceDocumentId: string
  readonly maps: WorkflowLabCloneMaps
}) {
  const chapters = await params.tx.projectEditChapter.findMany({
    where: { episodeId: params.sourceEpisodeId },
    orderBy: { chapterIndex: 'asc' },
  })

  for (const chapter of chapters) {
    if (chapter.sourceDocumentId && chapter.sourceDocumentId !== params.sourceDocumentId) {
      throw new Error(`WORKFLOW_LAB_CHAPTER_SOURCE_DOCUMENT_UNMAPPED:${chapter.id}`)
    }
    const sourceDocumentId = chapter.sourceDocumentId ? params.targetSourceDocumentId : null
    const provenanceJson = chapter.provenanceJson === null
      ? Prisma.JsonNull
      : toInputJson(rewriteWorkflowLabValue(chapter.provenanceJson, params.maps.allIds))
    const data = {
      title: chapter.title,
      summary: chapter.summary,
      sourceDocumentId,
      sourceStart: chapter.sourceStart,
      sourceEnd: chapter.sourceEnd,
      targetDurationSec: chapter.targetDurationSec,
      entrySnapshotJson: toNullableInputJson(chapter.entrySnapshotJson),
      eventsJson: toNullableInputJson(chapter.eventsJson),
      planVersion: chapter.planVersion,
      provenanceJson,
      status: chapter.status,
      renderStatus: chapter.renderStatus,
      renderTaskId: null,
      outputMediaId: chapter.outputMediaId,
    }
    const targetChapter = await params.tx.projectEditChapter.upsert({
      where: {
        episodeId_chapterIndex: {
          episodeId: params.targetEpisodeId,
          chapterIndex: chapter.chapterIndex,
        },
      },
      create: {
        episodeId: params.targetEpisodeId,
        chapterIndex: chapter.chapterIndex,
        ...data,
      },
      update: data,
      select: { id: true },
    })
    mapWorkflowLabId({
      maps: params.maps,
      scopedMap: params.maps.chapterIds,
      sourceId: chapter.id,
      targetId: targetChapter.id,
    })
  }
}

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
    mapWorkflowLabId({
      maps: params.maps,
      scopedMap: params.maps.allIds,
      sourceId: bible.sourceDocument.id,
      targetId: targetSourceDocument.id,
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

    await cloneWorkflowLabChapters({
      tx: params.tx,
      sourceEpisodeId: params.sourceEpisodeId,
      targetEpisodeId: params.targetEpisodeId,
      sourceDocumentId: bible.sourceDocument.id,
      targetSourceDocumentId: targetSourceDocument.id,
      maps: params.maps,
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
  const editScripts = await params.tx.projectEditScript.findMany({
    where: { episodeId: params.sourceEpisodeId },
    orderBy: { createdAt: 'asc' },
    include: {
      requirements: {
        orderBy: { createdAt: 'asc' },
      },
      shotExecutionPlan: true,
    },
  })

  for (const editScript of editScripts) {
    const targetChapterId = readMappedId(params.maps.chapterIds, editScript.chapterId)
    const createdEditScript = await params.tx.projectEditScript.create({
      data: {
        projectId: params.targetProjectId,
        episodeId: params.targetEpisodeId,
        chapterId: targetChapterId,
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
          chapterId: targetChapterId,
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
          chapterId: targetChapterId,
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
}
