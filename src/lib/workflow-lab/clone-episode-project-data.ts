import { Prisma } from '@prisma/client'
import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'
import { DEFAULT_EDIT_CHAPTER_INDEX } from '@/lib/edit-chapter'
import { mapWorkflowLabId, toInputJson, type WorkflowLabCloneMaps } from './clone-json'
import { cloneWorkflowLabEditFirstArtifacts } from './clone-edit-first'
import { cloneWorkflowLabStoryboards } from './clone-storyboards'
import {
  shouldWorkflowLabCloneStoryboards,
  shouldWorkflowLabCloneVideos,
} from './clone-stage'

export async function cloneEpisodeProjectData(params: {
  readonly tx: Prisma.TransactionClient
  readonly sourceProjectId: string
  readonly targetProjectId: string
  readonly sourceEpisodeId: string
  readonly targetEpisodeId: string
  readonly stage: EditFirstWorkflowStage
  readonly maps: WorkflowLabCloneMaps
}) {
  if (shouldWorkflowLabCloneStoryboards(params.stage)) {
    await cloneWorkflowLabStoryboards({
      tx: params.tx,
      sourceEpisodeId: params.sourceEpisodeId,
      targetEpisodeId: params.targetEpisodeId,
      maps: params.maps,
    })
  }

  await cloneWorkflowLabEditFirstArtifacts({
    tx: params.tx,
    targetProjectId: params.targetProjectId,
    sourceEpisodeId: params.sourceEpisodeId,
    targetEpisodeId: params.targetEpisodeId,
    stage: params.stage,
    maps: params.maps,
  })

  if (shouldWorkflowLabCloneVideos(params.stage)) {
    const targetChapter = await params.tx.projectEditChapter.findUnique({
      where: { episodeId_chapterIndex: { episodeId: params.targetEpisodeId, chapterIndex: DEFAULT_EDIT_CHAPTER_INDEX } },
      select: { id: true },
    })
    if (!targetChapter) throw new Error('WORKFLOW_LAB_TARGET_DEFAULT_EDIT_CHAPTER_REQUIRED')
    const finalOutput = await params.tx.projectEpisodeFinalOutput.findUnique({
      where: { episodeId: params.sourceEpisodeId },
    })
    if (finalOutput) {
      await params.tx.projectEpisodeFinalOutput.create({
        data: {
          episodeId: params.targetEpisodeId,
          renderStatus: finalOutput.renderStatus,
          renderTaskId: null,
          outputUrl: finalOutput.outputUrl,
          outputMediaId: finalOutput.outputMediaId,
        },
      })
    }
    const musicScore = await params.tx.projectEditMusicScore.findUnique({
      where: { episodeId: params.sourceEpisodeId },
    })
    if (musicScore) {
      await params.tx.projectEditMusicScore.create({
        data: {
          episodeId: params.targetEpisodeId,
          ...(musicScore.cuesJson !== null ? { cuesJson: musicScore.cuesJson as Prisma.InputJsonValue } : {}),
          ...(musicScore.mixJson !== null ? { mixJson: musicScore.mixJson as Prisma.InputJsonValue } : {}),
          ...(musicScore.diagnosticsJson !== null ? { diagnosticsJson: musicScore.diagnosticsJson as Prisma.InputJsonValue } : {}),
          version: musicScore.version,
          status: musicScore.status,
          taskId: null,
          timelineSignature: musicScore.timelineSignature,
          musicModel: musicScore.musicModel,
        },
      })
    }

    const videoGroups = await params.tx.projectVideoGroup.findMany({
      where: { episodeId: params.sourceEpisodeId },
      orderBy: { createdAt: 'asc' },
    })
    for (const group of videoGroups) {
      const createdGroup = await params.tx.projectVideoGroup.create({
        data: {
          projectId: params.targetProjectId,
          episodeId: params.targetEpisodeId,
          chapterId: targetChapter.id,
          gridMode: group.gridMode,
          shotIds: toInputJson(group.shotIds),
          durationSec: group.durationSec,
          prompt: group.prompt,
          status: group.status,
          taskId: null,
          errorCode: group.errorCode,
          errorMessage: group.errorMessage,
          referenceImageUrl: group.referenceImageUrl,
          referenceImageMediaId: group.referenceImageMediaId,
          videoUrl: group.videoUrl,
          videoMediaId: group.videoMediaId,
        },
        select: { id: true },
      })
      mapWorkflowLabId({
        maps: params.maps,
        scopedMap: params.maps.videoGroupIds,
        sourceId: group.id,
        targetId: createdGroup.id,
      })
    }
  }
}
