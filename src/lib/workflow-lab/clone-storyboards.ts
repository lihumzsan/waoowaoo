import { Prisma } from '@prisma/client'
import {
  mapWorkflowLabId,
  readMappedId,
  toInputJson,
  type WorkflowLabCloneMaps,
} from './clone-json'

export async function cloneWorkflowLabStoryboards(params: {
  readonly tx: Prisma.TransactionClient
  readonly sourceEpisodeId: string
  readonly targetEpisodeId: string
  readonly maps: WorkflowLabCloneMaps
}) {
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
    const targetEditScriptId = storyboard.editScriptId ? readMappedId(params.maps.editScriptIds, storyboard.editScriptId) : null
    const createdStoryboard = await params.tx.projectStoryboard.create({
      data: {
        episodeId: params.targetEpisodeId,
        ...(targetEditScriptId ? { editScriptId: targetEditScriptId } : {}),
        storyboardImageUrl: storyboard.storyboardImageUrl,
        panelCount: storyboard.panelCount,
        storyboardTextJson: storyboard.storyboardTextJson,
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
          characters: panel.characters,
          props: panel.props,
          srtSegment: panel.srtSegment,
          srtStart: panel.srtStart,
          srtEnd: panel.srtEnd,
          duration: panel.duration,
          imagePrompt: panel.imagePrompt,
          imageUrl: panel.imageUrl,
          imageMediaId: panel.imageMediaId,
          videoPrompt: panel.videoPrompt,
          videoUrl: panel.videoUrl,
          lastVideoGenerationOptions: panel.lastVideoGenerationOptions === null
            ? Prisma.JsonNull
            : toInputJson(panel.lastVideoGenerationOptions),
          videoMediaId: panel.videoMediaId,
          sceneType: panel.sceneType,
          candidateImages: panel.candidateImages,
          sourceShotNumber: panel.sourceShotNumber,
          sourceGenerationSegmentId: panel.sourceGenerationSegmentId,
          executionSnapshotJson: panel.executionSnapshotJson === null
            ? Prisma.JsonNull
            : toInputJson(panel.executionSnapshotJson),
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
          imageUrl: supplementaryPanel.imageUrl,
          imageMediaId: supplementaryPanel.imageMediaId,
          characters: supplementaryPanel.characters,
          location: supplementaryPanel.location,
        },
      })
    }
  }
}
