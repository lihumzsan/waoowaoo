import { Prisma } from '@prisma/client'
import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'
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
    const editorProject = await params.tx.videoEditorProject.findUnique({
      where: { episodeId: params.sourceEpisodeId },
    })
    if (editorProject) {
      await params.tx.videoEditorProject.create({
        data: {
          episodeId: params.targetEpisodeId,
          projectData: editorProject.projectData,
          renderStatus: editorProject.renderStatus,
          renderTaskId: null,
          outputUrl: editorProject.outputUrl,
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
          gridMode: group.gridMode,
          shotNumbers: toInputJson(group.shotNumbers),
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
