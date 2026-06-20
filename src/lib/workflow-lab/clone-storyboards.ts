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
      blockingArtifacts: {
        orderBy: { createdAt: 'asc' },
      },
      supplementaryPanels: {
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  for (const storyboard of storyboards) {
    const targetClipId = readMappedId(params.maps.clipIds, storyboard.clipId)
    const createdStoryboard = await params.tx.projectStoryboard.create({
      data: {
        episodeId: params.targetEpisodeId,
        clipId: targetClipId,
        storyboardImageUrl: storyboard.storyboardImageUrl,
        panelCount: storyboard.panelCount,
        storyboardTextJson: storyboard.storyboardTextJson,
        imageHistory: storyboard.imageHistory,
        candidateImages: storyboard.candidateImages,
        lastError: storyboard.lastError,
        photographyPlan: storyboard.photographyPlan,
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
          imageHistory: panel.imageHistory,
          videoPrompt: panel.videoPrompt,
          firstLastFramePrompt: panel.firstLastFramePrompt,
          videoUrl: panel.videoUrl,
          videoGenerationMode: panel.videoGenerationMode,
          lastVideoGenerationOptions: panel.lastVideoGenerationOptions === null
            ? Prisma.JsonNull
            : toInputJson(panel.lastVideoGenerationOptions),
          videoMediaId: panel.videoMediaId,
          sceneType: panel.sceneType,
          candidateImages: panel.candidateImages,
          linkedToNextPanel: panel.linkedToNextPanel,
          sketchImageUrl: panel.sketchImageUrl,
          sketchImageMediaId: panel.sketchImageMediaId,
          photographyRules: panel.photographyRules,
          actingNotes: panel.actingNotes,
          previousImageUrl: panel.previousImageUrl,
          previousImageMediaId: panel.previousImageMediaId,
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

    for (const artifact of storyboard.blockingArtifacts) {
      await params.tx.projectStoryboardBlockingArtifact.create({
        data: {
          storyboardId: createdStoryboard.id,
          kind: artifact.kind,
          sourceVideoBlockId: artifact.sourceVideoBlockId,
          groupIndex: artifact.groupIndex,
          prompt: artifact.prompt,
          imageUrl: artifact.imageUrl,
          imageMediaId: artifact.imageMediaId,
          candidateImages: artifact.candidateImages,
          metadataJson: artifact.metadataJson === null ? Prisma.JsonNull : toInputJson(artifact.metadataJson),
          status: artifact.status,
          errorMessage: artifact.errorMessage,
        },
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
