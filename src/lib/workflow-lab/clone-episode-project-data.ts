import { Prisma } from '@prisma/client'
import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'
import {
  mapWorkflowLabId,
  readMappedId,
  toInputJson,
  type WorkflowLabCloneMaps,
} from './clone-json'
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
  await cloneWorkflowLabEditFirstArtifacts({
    tx: params.tx,
    targetProjectId: params.targetProjectId,
    sourceEpisodeId: params.sourceEpisodeId,
    targetEpisodeId: params.targetEpisodeId,
    stage: params.stage,
    maps: params.maps,
  })

  if (shouldWorkflowLabCloneStoryboards(params.stage)) {
    await cloneWorkflowLabStoryboards({
      tx: params.tx,
      sourceEpisodeId: params.sourceEpisodeId,
      targetEpisodeId: params.targetEpisodeId,
      stage: params.stage,
      maps: params.maps,
    })
  }

  if (shouldWorkflowLabCloneVideos(params.stage)) {
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
    const soundscape = await params.tx.projectEditSoundscape.findUnique({
      where: { episodeId: params.sourceEpisodeId },
    })
    if (soundscape) {
      await params.tx.projectEditSoundscape.create({
        data: {
          episodeId: params.targetEpisodeId,
          ...(soundscape.planJson !== null ? { planJson: soundscape.planJson as Prisma.InputJsonValue } : {}),
          ...(soundscape.sourcesJson !== null ? { sourcesJson: soundscape.sourcesJson as Prisma.InputJsonValue } : {}),
          ...(soundscape.mixJson !== null ? { mixJson: soundscape.mixJson as Prisma.InputJsonValue } : {}),
          ...(soundscape.diagnosticsJson !== null ? { diagnosticsJson: soundscape.diagnosticsJson as Prisma.InputJsonValue } : {}),
          version: soundscape.version,
          status: soundscape.status,
          taskId: null,
          timelineSignature: soundscape.timelineSignature,
          soundEffectModel: soundscape.soundEffectModel,
        },
      })
    }

    const videoGroups = await params.tx.projectVideoGroup.findMany({
      where: { episodeId: params.sourceEpisodeId },
      orderBy: { createdAt: 'asc' },
    })
    for (const group of videoGroups) {
      const targetChapterId = readMappedId(params.maps.chapterIds, group.chapterId)
      const createdGroup = await params.tx.projectVideoGroup.create({
        data: {
          projectId: params.targetProjectId,
          episodeId: params.targetEpisodeId,
          chapterId: targetChapterId,
          gridMode: group.gridMode,
          shotIds: toInputJson(group.shotIds),
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
