import type { ProjectFinalVideo } from '@/types/project'
import type { WorkspaceCanvasBgmScoreDetails } from '../node-canvas-types'
import type { WorkspaceNodeProjectionContext } from './workspace-node-projection-shared'
import type { WorkspaceVideoSegmentProjection } from './workspace-node-video-segment-projection'
import { bgmDesignSchema } from '@/lib/bgm-design/types'
import {
  SHOT_GRID_START_X,
  TASK_RUNTIME_TARGETS,
  WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE,
  createMediaNode,
  hasStreamTarget,
  layoutPosition,
  resolveWorkspaceCanvasNodeMaterialization,
  resourcePresentationFromStatus,
  runtimeTargets,
  workspaceCanvasPendingResourcePresentation,
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
    activeTaskTargets,
    streamTargets,
    finalVideo,
    videoSegments,
    savedLayouts,
    translate,
    onAction,
    nodes,
    stylePreviewImageUrl,
  } = context
  const { bgmScoreDefaultY } = videoProjection

  const bgmDetails = bgmScoreDetails(finalVideo)
  const bgmProjection = resolveWorkspaceCanvasNodeMaterialization('bgmScore', activeTaskTargets, {
    identityAvailable: true,
    resourceAvailable: Boolean(bgmDetails),
    streamAvailable: hasStreamTarget(streamTargets, 'bgmScore', episodeId),
    submissionAvailable: false,
    targetId: episodeId,
  })
  if (bgmProjection.materialized) {
    const bgmNodeId = workspaceNodeId.bgmScore(episodeId)
    const bgmPresentation = bgmDetails ? (resourcePresentationFromStatus(bgmDetails.status) ?? workspaceCanvasPendingResourcePresentation()) : null
    const bgmReadyForGeneration = bgmDetails?.hasPromptDesign === true && bgmDetails.status !== 'planning' && bgmDetails.status !== 'generating'
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
          actionLabel: translate(
            bgmReadyForGeneration ? (bgmDetails?.mixUrl ? 'actions.regenerateBgmScore' : 'actions.generateBgmScore') : 'actions.planBgmScore',
          ),
          action: bgmReadyForGeneration ? { type: 'generate_bgm_score' as const } : { type: 'plan_bgm_score' as const },
          runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEpisodeBgmScore(episodeId)),
          bgmScoreDetails: bgmDetails,
          onAction,
        },
      }),
    )
  }
}
