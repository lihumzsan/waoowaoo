import { Prisma } from '@prisma/client'
import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'
import {
  mapWorkflowLabId,
  readMappedId,
  rewriteWorkflowLabValue,
  toInputJson,
  type WorkflowLabCloneMaps,
} from './clone-json'
import {
  shouldWorkflowLabKeepStoryboardImages,
  shouldWorkflowLabKeepStoryboardVideos,
} from './clone-stage'

export async function cloneWorkflowLabStoryboards(params: {
  readonly tx: Prisma.TransactionClient
  readonly sourceEpisodeId: string
  readonly targetEpisodeId: string
  readonly stage: EditFirstWorkflowStage
  readonly maps: WorkflowLabCloneMaps
}) {
  const keepImages = shouldWorkflowLabKeepStoryboardImages(params.stage)
  const keepVideos = shouldWorkflowLabKeepStoryboardVideos(params.stage)
  const storyboards = await params.tx.projectStoryboard.findMany({
    where: { episodeId: params.sourceEpisodeId },
    orderBy: { createdAt: 'asc' },
    include: {
      panels: {
        orderBy: { panelIndex: 'asc' },
      },
      supplementaryPanels: {
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  for (const storyboard of storyboards) {
    const targetChapterId = readMappedId(params.maps.chapterIds, storyboard.chapterId)
    const targetEditScriptId = storyboard.editScriptId ? readMappedId(params.maps.editScriptIds, storyboard.editScriptId) : null
    const createdStoryboard = await params.tx.projectStoryboard.create({
      data: {
        episodeId: params.targetEpisodeId,
        chapterId: targetChapterId,
        ...(targetEditScriptId ? { editScriptId: targetEditScriptId } : {}),
        storyboardImageUrl: keepImages ? storyboard.storyboardImageUrl : null,
        panelCount: storyboard.panelCount,
        storyboardTextJson: rewriteWorkflowLabValue(storyboard.storyboardTextJson, params.maps.allIds),
        lastError: storyboard.lastError,
      },
      select: { id: true },
    })
    mapWorkflowLabId({
      maps: params.maps,
      scopedMap: params.maps.storyboardIds,
      sourceId: storyboard.id,
      targetId: createdStoryboard.id,
    })

    for (const panel of storyboard.panels) {
      const createdPanel = await params.tx.projectPanel.create({
        data: {
          storyboardId: createdStoryboard.id,
          panelIndex: panel.panelIndex,
          panelNumber: panel.panelNumber,
          shotType: panel.shotType,
          cameraMove: panel.cameraMove,
          description: panel.description,
          location: panel.location,
          characters: rewriteWorkflowLabValue(panel.characters, params.maps.allIds),
          props: panel.props,
          srtSegment: panel.srtSegment,
          srtStart: panel.srtStart,
          srtEnd: panel.srtEnd,
          duration: panel.duration,
          imagePrompt: panel.imagePrompt,
          imageUrl: keepImages ? panel.imageUrl : null,
          imageMediaId: keepImages ? panel.imageMediaId : null,
          videoPrompt: panel.videoPrompt,
          videoUrl: keepVideos ? panel.videoUrl : null,
          lastVideoGenerationOptions: !keepVideos || panel.lastVideoGenerationOptions === null
            ? Prisma.JsonNull
            : toInputJson(panel.lastVideoGenerationOptions),
          videoMediaId: keepVideos ? panel.videoMediaId : null,
          sceneType: panel.sceneType,
          candidateImages: panel.candidateImages,
          sourceShotId: panel.sourceShotId,
          sourceGenerationSegmentId: panel.sourceGenerationSegmentId,
          executionSnapshotJson: panel.executionSnapshotJson === null
            ? Prisma.JsonNull
            : toInputJson(rewriteWorkflowLabValue(panel.executionSnapshotJson, params.maps.allIds)),
          renderFactsJson: panel.renderFactsJson === null
            ? Prisma.JsonNull
            : toInputJson(panel.renderFactsJson),
          actingNotes: panel.actingNotes,
        },
        select: { id: true },
      })
      mapWorkflowLabId({
        maps: params.maps,
        scopedMap: params.maps.panelIds,
        sourceId: panel.id,
        targetId: createdPanel.id,
      })
    }

    for (const supplementaryPanel of storyboard.supplementaryPanels) {
      await params.tx.supplementaryPanel.create({
        data: {
          storyboardId: createdStoryboard.id,
          sourceType: supplementaryPanel.sourceType,
          sourcePanelId: supplementaryPanel.sourcePanelId
            ? params.maps.panelIds.get(supplementaryPanel.sourcePanelId) ?? supplementaryPanel.sourcePanelId
            : null,
          description: supplementaryPanel.description,
          imagePrompt: supplementaryPanel.imagePrompt,
          imageUrl: keepImages ? supplementaryPanel.imageUrl : null,
          imageMediaId: keepImages ? supplementaryPanel.imageMediaId : null,
          characters: rewriteWorkflowLabValue(supplementaryPanel.characters, params.maps.allIds),
          location: supplementaryPanel.location,
        },
      })
    }
  }
}
