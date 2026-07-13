import type { ProjectEditScript, ProjectFinalVideo } from '@/types/project'
import type { WorkspaceCanvasBgmScoreDetails, WorkspaceCanvasSoundscapeDetails } from '../node-canvas-types'
import type { WorkspaceNodeProjectionContext } from './workspace-node-projection-shared'
import type { WorkspaceStoryboardProjection } from './workspace-node-storyboard-projection'
import {
  FINAL_TIMELINE_GAP_Y,
  SHOT_GRID_GAP_X,
  SHOT_GRID_START_X,
  TASK_RUNTIME_TARGETS,
  WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE,
  WORKSPACE_CANVAS_FINAL_NODE_SIZE,
  createEdge,
  createMediaNode,
  hasStreamTarget,
  layoutPosition,
  maxNodeBottomY,
  primaryPanelImageUrl,
  readShotIds,
  resolvePanelShotNumber,
  resolveWorkspaceCanvasNodeMaterialization,
  resourcePresentationFromStatus,
  runtimeTargets,
  workspaceCanvasPendingResourcePresentation,
  workspaceCanvasSucceededResourcePresentation,
  workspaceNodeId,
} from './workspace-node-projection-shared'

function bgmScoreDetails(finalVideo: ProjectFinalVideo | null | undefined): WorkspaceCanvasBgmScoreDetails | undefined {
  const bgmScore = finalVideo?.musicScore
  if (!bgmScore) return undefined
  return {
    status: bgmScore.status,
    durationSeconds: bgmScore.durationSeconds ?? null,
    musicModel: bgmScore.musicModel ?? null,
    hasPromptDesign: Boolean(bgmScore.plan),
    promptDesignMissing: !bgmScore.plan,
    designSectionCount: bgmScore.plan?.scoreDesign.sections.length ?? 0,
    promptSectionCount: bgmScore.plan?.promptSections.length ?? 0,
    virtualLayerCount: bgmScore.plan?.virtualLayers.length ?? 0,
    mixUrl: bgmScore.mix?.url ?? null,
    errorMessage: bgmScore.errorMessage ?? null,
    scoreOverview: bgmScore.plan?.scoreDesign.overview ?? null,
    designSections: bgmScore.plan?.scoreDesign.sections ?? [],
    promptSections: bgmScore.plan?.promptSections ?? [],
    virtualLayers: bgmScore.plan?.virtualLayers ?? [],
    finalPrompt: bgmScore.plan?.finalPrompt ?? null,
  }
}

function soundscapeDetails(
  finalVideo: ProjectFinalVideo | null | undefined,
  editScripts: readonly ProjectEditScript[],
): WorkspaceCanvasSoundscapeDetails | undefined {
  const soundscape = finalVideo?.soundscape
  if (!soundscape) return undefined
  const sources = soundscape.plan?.sources ?? []
  const sourceIndexById = new Map(sources.map((source, index) => [source.sourceId, index + 1]))
  const shotNumberById = new Map(editScripts.flatMap((script) => script.shots.map((shot) => [shot.shotId, shot.shotNumber] as const)))
  return {
    status: soundscape.status,
    decision: soundscape.decision ?? null,
    soundEffectModel: soundscape.soundEffectModel ?? null,
    sourceCount: soundscape.sourceCount,
    sectionCount: soundscape.sectionCount,
    sources: sources.map((source, index) => ({
      key: source.sourceId,
      sourceIndex: index + 1,
      prompt: source.prompt,
      loopDurationSeconds: source.loopDurationSeconds,
      promptInfluence: source.promptInfluence,
    })),
    sections: (soundscape.plan?.sections ?? []).map((section, index) => {
      const sourceIndex = sourceIndexById.get(section.sourceId)
      const rangeStart = shotNumberById.get(section.fromShotId)
      const rangeEnd = shotNumberById.get(section.toShotId)
      if (!sourceIndex) throw new Error(`SOUNDSCAPE_SECTION_SOURCE_UNKNOWN:${section.sourceId}`)
      if (!rangeStart || !rangeEnd) {
        throw new Error(`SOUNDSCAPE_SECTION_SHOT_UNKNOWN:${section.fromShotId}:${section.toShotId}`)
      }
      return {
        key: `${section.sourceId}:${section.fromShotId}:${section.toShotId}:${index}`,
        sourceIndex,
        rangeKind: 'shot' as const,
        rangeStart,
        rangeEnd,
        perspective: section.perspective,
        intensity: section.intensity,
        transitionIn: section.transitionIn,
        transitionOut: section.transitionOut,
      }
    }),
    mixUrl: soundscape.mix?.url ?? null,
    errorMessage: soundscape.errorMessage ?? null,
  }
}

export function appendWorkspaceAudioFinalProjection(context: WorkspaceNodeProjectionContext, storyboard: WorkspaceStoryboardProjection): void {
  const {
    projectId,
    episodeId,
    episodeName,
    editFirstWorkflow,
    editScript,
    editScripts,
    activeTaskTargets,
    streamTargets,
    finalVideo,
    videoGroups,
    savedLayouts,
    translate,
    onAction,
    nodes,
    edges,
    editFirstCanvasVisibility,
    stylePreviewImageUrl,
  } = context
  const { panelList, projectedVideoPlans, bgmScoreDefaultY } = storyboard

  let bgmNodeId: string | null = null
  const bgmDetails = bgmScoreDetails(finalVideo)
  const bgmProjection = resolveWorkspaceCanvasNodeMaterialization('bgmScore', activeTaskTargets, {
    identityAvailable: true,
    workflowVisible: editFirstCanvasVisibility.bgmScore,
    resourceAvailable: Boolean(bgmDetails),
    streamAvailable: hasStreamTarget(streamTargets, 'bgmScore', episodeId),
    submissionAvailable: false,
    targetId: episodeId,
  })
  if (bgmProjection.materialized) {
    bgmNodeId = workspaceNodeId.bgmScore(episodeId)
    const bgmPresentation = bgmDetails ? (resourcePresentationFromStatus(bgmDetails.status) ?? workspaceCanvasPendingResourcePresentation()) : null
    const bgmReadyForGeneration = bgmDetails?.hasPromptDesign === true && bgmDetails.status !== 'planning' && bgmDetails.status !== 'generating'
    const bgmActionAvailable =
      bgmReadyForGeneration ||
      editFirstWorkflow.operationPolicy.allowedOperationIds.includes('plan_episode_bgm_score') ||
      editFirstWorkflow.operationPolicy.allowedOperationIds.includes('generate_episode_bgm_score')
    nodes.push(
      createMediaNode({
        id: bgmNodeId,
        position: layoutPosition(savedLayouts, bgmNodeId, { x: SHOT_GRID_START_X, y: bgmScoreDefaultY }),
        width: WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE.width,
        height: WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE.height,
        loadingContext: { styleImageUrl: stylePreviewImageUrl },
        data: {
          projectId,
          episodeName,
          kind: 'bgmScore',
          layoutNodeType: 'bgmScore',
          targetType: 'episode',
          targetId: episodeId,
          title: translate('nodes.bgmScore.title'),
          eyebrow: translate('nodes.bgmScore.eyebrow'),
          body: bgmDetails?.scoreOverview ?? translate('nodes.bgmScore.body', { videos: videoGroups.length }),
          meta: bgmDetails?.musicModel ?? '',
          ...(bgmPresentation ?? workspaceCanvasPendingResourcePresentation()),
          terminalHandoffTaskId: finalVideo?.musicScore?.taskId ?? null,
          ...(bgmActionAvailable
            ? {
                actionLabel: translate(
                  bgmReadyForGeneration ? (bgmDetails?.mixUrl ? 'actions.regenerateBgmScore' : 'actions.generateBgmScore') : 'actions.planBgmScore',
                ),
                action: bgmReadyForGeneration ? { type: 'generate_bgm_score' as const } : { type: 'plan_bgm_score' as const },
              }
            : {}),
          runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEpisodeBgmScore(episodeId)),
          bgmScoreDetails: bgmDetails,
          onAction,
        },
      }),
    )
  }
  let soundscapeNodeId: string | null = null
  const projectedSoundscapeDetails = soundscapeDetails(finalVideo, editScripts.length > 0 ? editScripts : editScript ? [editScript] : [])
  const soundscapeProjection = resolveWorkspaceCanvasNodeMaterialization('soundscape', activeTaskTargets, {
    identityAvailable: true,
    workflowVisible: editFirstCanvasVisibility.soundscape,
    resourceAvailable: Boolean(projectedSoundscapeDetails),
    streamAvailable: hasStreamTarget(streamTargets, 'soundscape', episodeId),
    submissionAvailable: false,
    targetId: episodeId,
  })
  if (soundscapeProjection.materialized) {
    soundscapeNodeId = workspaceNodeId.soundscape(episodeId)
    const details = projectedSoundscapeDetails
    const soundscapeReadyForGeneration = details?.decision === 'soundscape' && details.status !== 'planning' && details.status !== 'generating'
    const soundscapePresentation = details ? (resourcePresentationFromStatus(details.status) ?? workspaceCanvasPendingResourcePresentation()) : null
    const soundscapeActionAvailable =
      Boolean(details) ||
      editFirstWorkflow.operationPolicy.allowedOperationIds.includes('plan_episode_soundscape') ||
      editFirstWorkflow.operationPolicy.allowedOperationIds.includes('generate_episode_soundscape')
    nodes.push(
      createMediaNode({
        id: soundscapeNodeId,
        position: layoutPosition(savedLayouts, soundscapeNodeId, {
          x: SHOT_GRID_START_X + WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE.width + SHOT_GRID_GAP_X,
          y: bgmScoreDefaultY,
        }),
        width: WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE.width,
        height: WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE.height,
        loadingContext: { styleImageUrl: stylePreviewImageUrl },
        data: {
          projectId,
          episodeName,
          kind: 'soundscape',
          layoutNodeType: 'soundscape',
          targetType: 'episode',
          targetId: episodeId,
          title: translate('nodes.soundscape.title'),
          eyebrow: translate('nodes.soundscape.eyebrow'),
          body:
            details?.decision === 'none_needed'
              ? translate('nodes.soundscape.noneNeededBody')
              : translate('nodes.soundscape.body', { videos: videoGroups.length }),
          meta: details?.soundEffectModel ?? '',
          ...(soundscapePresentation ?? workspaceCanvasPendingResourcePresentation()),
          terminalHandoffTaskId: finalVideo?.soundscape?.taskId ?? null,
          ...(soundscapeActionAvailable
            ? {
                actionLabel: translate(
                  soundscapeReadyForGeneration ? (details?.mixUrl ? 'actions.regenerateSoundscape' : 'actions.generateSoundscape') : 'actions.planSoundscape',
                ),
                action: soundscapeReadyForGeneration ? { type: 'generate_soundscape' as const } : { type: 'plan_soundscape' as const },
              }
            : {}),
          runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEpisodeSoundscape(episodeId)),
          soundscapeDetails: details,
          onAction,
        },
      }),
    )
  }
  const bgmStageBottomY = Math.max(
    maxNodeBottomY(nodes, 'bgmScore') ?? bgmScoreDefaultY + WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE.height,
    maxNodeBottomY(nodes, 'soundscape') ?? bgmScoreDefaultY + WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE.height,
  )

  let finalNodeId: string | null = null
  const finalTimelineProjection = resolveWorkspaceCanvasNodeMaterialization('finalTimeline', activeTaskTargets, {
    identityAvailable: true,
    workflowVisible: editFirstCanvasVisibility.finalTimeline,
    resourceAvailable: Boolean(finalVideo?.renderStatus || finalVideo?.outputUrl),
    streamAvailable: false,
    submissionAvailable: false,
    targetId: episodeId,
  })
  if (finalTimelineProjection.materialized) {
    const finalEditScripts = editScripts.length > 0 ? editScripts : editScript ? [editScript] : []
    const finalShotNumberById = new Map(finalEditScripts.flatMap((script) => script.shots.map((shot) => [shot.shotId, shot.shotNumber] as const)))
    finalNodeId = workspaceNodeId.finalTimeline(episodeId)
    const finalPresentation = finalVideo?.outputUrl
      ? workspaceCanvasSucceededResourcePresentation()
      : finalVideo?.renderStatus
        ? (resourcePresentationFromStatus(finalVideo.renderStatus) ?? workspaceCanvasPendingResourcePresentation())
        : null
    const finalRenderActionAvailable = editFirstWorkflow.operationPolicy.allowedOperationIds.includes('render_final_video')
    nodes.push(
      createMediaNode({
        id: finalNodeId,
        position: layoutPosition(savedLayouts, finalNodeId, {
          x: SHOT_GRID_START_X,
          y: bgmStageBottomY + FINAL_TIMELINE_GAP_Y,
        }),
        width: WORKSPACE_CANVAS_FINAL_NODE_SIZE.width,
        height: WORKSPACE_CANVAS_FINAL_NODE_SIZE.height,
        loadingContext: { styleImageUrl: stylePreviewImageUrl },
        data: {
          projectId,
          episodeName,
          kind: 'finalTimeline',
          layoutNodeType: 'finalTimeline',
          targetType: 'episode',
          targetId: episodeId,
          title: translate('nodes.finalTimeline.title'),
          eyebrow: translate('nodes.finalTimeline.eyebrow'),
          body: finalVideo?.outputUrl ?? translate('nodes.finalTimeline.body'),
          meta: finalVideo?.renderStatus ?? '',
          ...(finalPresentation ?? workspaceCanvasPendingResourcePresentation()),
          ...(finalRenderActionAvailable
            ? {
                actionLabel: translate('actions.renderFinalVideo'),
                action: { type: 'render_final_video' as const },
              }
            : {}),
          runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEpisodeFinalRender(episodeId)),
          finalDetails: {
            totalShots: finalEditScripts.length > 0 ? finalEditScripts.reduce((sum, script) => sum + script.shotCount, 0) : panelList.length,
            totalImages: panelList.filter((panel) => Boolean(primaryPanelImageUrl(panel))).length,
            totalVideos:
              panelList.filter((panel) => Boolean(panel.videoMedia?.url ?? panel.videoUrl)).length +
              videoGroups.filter((group) => Boolean(group.videoMedia?.url ?? group.videoUrl)).length,
            totalDuration: finalEditScripts.length > 0 ? finalEditScripts.reduce((sum, script) => sum + script.durationSec, 0) : null,
            orderedVideoLabels: [
              ...videoGroups.map((group) =>
                readShotIds(group.shotIds)
                  .map((shotId) => {
                    const shotNumber = finalShotNumberById.get(shotId)
                    if (!shotNumber) throw new Error(`FINAL_VIDEO_TIMELINE_SHOT_UNKNOWN:${shotId}`)
                    return shotNumber
                  })
                  .join(', '),
              ),
              ...panelList.filter((panel) => Boolean(panel.videoMedia?.url ?? panel.videoUrl)).map((panel) => String(resolvePanelShotNumber(panel))),
            ],
            outputUrl: finalVideo?.outputUrl,
            renderStatus: finalVideo?.renderStatus,
          },
          onAction,
        },
      }),
    )
  }

  if (finalNodeId) {
    projectedVideoPlans.forEach(({ script, segmentIndex }) => {
      edges.push(createEdge(`edge:video-plan-final:${script.id}:${segmentIndex + 1}`, workspaceNodeId.videoPlan(script.id, segmentIndex + 1), finalNodeId))
    })
  }
  if (bgmNodeId && finalNodeId) {
    edges.push(createEdge(`edge:bgm-final:${episodeId}`, bgmNodeId, finalNodeId))
  }
  if (soundscapeNodeId && finalNodeId) {
    edges.push(createEdge(`edge:soundscape-final:${episodeId}`, soundscapeNodeId, finalNodeId))
  }
}
