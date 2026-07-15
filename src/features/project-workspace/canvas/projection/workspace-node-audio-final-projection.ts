import type { ProjectFinalVideo } from '@/types/project'
import type { WorkspaceCanvasBgmScoreDetails } from '../node-canvas-types'
import type { WorkspaceNodeProjectionContext } from './workspace-node-projection-shared'
import type { WorkspaceVideoSegmentProjection } from './workspace-node-video-segment-projection'
import { bgmDesignSchema } from '@/lib/bgm-design/types'
import {
  FINAL_TIMELINE_GAP_Y,
  SHOT_GRID_START_X,
  TASK_RUNTIME_TARGETS,
  WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE,
  WORKSPACE_CANVAS_FINAL_NODE_SIZE,
  createEdge,
  createMediaNode,
  hasStreamTarget,
  layoutPosition,
  maxNodeBottomY,
  resolveWorkspaceCanvasNodeMaterialization,
  resourcePresentationFromStatus,
  runtimeTargets,
  workspaceCanvasPendingResourcePresentation,
  workspaceCanvasSucceededResourcePresentation,
  workspaceNodeId,
} from './workspace-node-projection-shared'

function bgmScoreDetails(finalVideo: ProjectFinalVideo | null | undefined): WorkspaceCanvasBgmScoreDetails | undefined {
  const bgmScore = finalVideo?.musicScore
  const parsedDesign = bgmDesignSchema.safeParse(finalVideo?.bgmDesign?.design)
  if (!parsedDesign.success) return bgmScore ? {
    status: bgmScore.status,
    durationSeconds: bgmScore.durationSeconds ?? null,
    musicModel: bgmScore.musicModel ?? null,
    hasPromptDesign: false,
    promptDesignMissing: true,
    designSectionCount: 0,
    promptSectionCount: 0,
    virtualLayerCount: 0,
    mixUrl: bgmScore.mix?.url ?? null,
    errorMessage: bgmScore.errorMessage ?? null,
    scoreOverview: null,
    designSections: [],
    promptSections: [],
    virtualLayers: [],
    finalPrompt: null,
  } : undefined
  const design = parsedDesign.data
  const cue = design.scoreCue
  return {
    status: bgmScore?.status ?? (cue ? 'planned' : 'completed'),
    durationSeconds: design.clock.totalFrames / design.clock.fps,
    musicModel: finalVideo?.bgmDesign?.musicModel ?? bgmScore?.musicModel ?? null,
    hasPromptDesign: Boolean(cue),
    promptDesignMissing: !cue,
    designSectionCount: cue?.musicTheorySpec.phases.length ?? 0,
    promptSectionCount: 0,
    virtualLayerCount: cue?.musicTheorySpec.orchestration.length ?? 0,
    mixUrl: bgmScore?.mix?.url ?? null,
    errorMessage: bgmScore?.errorMessage ?? null,
    scoreOverview: cue?.narrativeDiagnosis.musicShouldDo ?? null,
    designSections: (cue?.musicTheorySpec.phases ?? []).map((phase) => ({
      category: phase.function,
      title: phase.phaseId,
      purpose: `${phase.density} / ${phase.spectralBand}`,
      startSec: phase.range.startFrame / design.clock.fps,
      endSec: phase.range.endFrameExclusive / design.clock.fps,
      content: `${Math.round(phase.energy * 100)}% energy`,
    })),
    promptSections: [],
    virtualLayers: (cue?.musicTheorySpec.orchestration ?? []).map((part) => ({
      name: part.instrument,
      purpose: `${part.role} / ${part.register}`,
      content: part.techniques.join(', '),
    })),
    finalPrompt: null,
  }
}

export function appendWorkspaceAudioFinalProjection(context: WorkspaceNodeProjectionContext, videoProjection: WorkspaceVideoSegmentProjection): void {
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
    videoSegments,
    savedLayouts,
    translate,
    onAction,
    nodes,
    edges,
    editFirstCanvasVisibility,
    stylePreviewImageUrl,
  } = context
  const { projectedVideoPlans, bgmScoreDefaultY } = videoProjection

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
      editFirstWorkflow.operationPolicy.allowedOperationIds.includes('plan_episode_bgm_design') ||
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
          body: bgmDetails?.scoreOverview ?? translate('nodes.bgmScore.body', { videos: videoSegments.length }),
          meta: bgmDetails?.musicModel ?? '',
          ...(bgmPresentation ?? workspaceCanvasPendingResourcePresentation()),
          terminalHandoffTaskId: finalVideo?.bgmDesign?.taskId ?? null,
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
  const bgmStageBottomY = maxNodeBottomY(nodes, 'bgmScore')
    ?? bgmScoreDefaultY + WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE.height

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
            totalShots: finalEditScripts.reduce((sum, script) => sum + script.shotCount, 0),
            totalImages: 0,
            totalVideos: videoSegments.filter((segment) => Boolean(segment.videoMedia?.url)).length,
            totalDuration: finalEditScripts.length > 0 ? finalEditScripts.reduce((sum, script) => sum + script.durationSec, 0) : null,
            orderedVideoLabels: [
              ...finalEditScripts.flatMap((script) => script.generationSegments.map((segment) =>
                segment.shotIds
                  .map((shotId) => {
                    const shotNumber = finalShotNumberById.get(shotId)
                    if (!shotNumber) throw new Error(`FINAL_VIDEO_TIMELINE_SHOT_UNKNOWN:${shotId}`)
                    return shotNumber
                  })
                  .join(', '),
              )),
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
}
