import type { ProjectEditScript, ProjectVideoSegment } from '@/types/project'
import type { WorkspaceNodeProjectionContext } from './workspace-node-projection-shared'
import type { WorkspacePlanningProjection } from './workspace-node-planning-projection'
import type { WorkspaceAssetExecutionProjection } from './workspace-node-asset-execution-projection'
import {
  SHOT_GRID_GAP_X,
  SHOT_GRID_START_X,
  STAGE_START_Y,
  TASK_RUNTIME_TARGETS,
  VIDEO_PLAN_GRID_COLUMNS,
  VIDEO_PLAN_GRID_GAP_Y,
  WORKSPACE_CANVAS_VIDEO_PLAN_NODE_SIZE,
  createEdge,
  createMediaNode,
  layoutPosition,
  maxNodeBottomY,
  resourcePresentationFromStatus,
  runtimeTargets,
  workspaceCanvasPendingResourcePresentation,
  workspaceNodeId,
} from './workspace-node-projection-shared'

export interface ProjectedWorkspaceVideoPlan {
  readonly script: ProjectEditScript
  readonly segment: ProjectEditScript['generationSegments'][number]
  readonly segmentIndex: number
  readonly videoSegment: ProjectVideoSegment | null
}

export interface WorkspaceVideoSegmentProjection {
  readonly projectedVideoPlans: readonly ProjectedWorkspaceVideoPlan[]
  readonly bgmScoreDefaultY: number
}

function outputAspectRatio(segment: ProjectVideoSegment | null): number | null {
  const width = segment?.videoMedia?.width
  const height = segment?.videoMedia?.height
  if (!width || !height || width <= 0 || height <= 0) return null
  return width / height
}

export function appendWorkspaceVideoSegmentProjection(
  context: WorkspaceNodeProjectionContext,
  planning: WorkspacePlanningProjection,
  assetExecution: WorkspaceAssetExecutionProjection,
): WorkspaceVideoSegmentProjection {
  const {
    projectId,
    episodeName,
    videoSegments,
    savedLayouts,
    translate,
    onAction,
    nodes,
    edges,
    projectedEditScripts,
    editFirstWorkflow,
    editFirstCanvasVisibility,
    stylePreviewImageUrl,
  } = context
  const { editScriptNodeId } = planning
  const { executionNodeId, executionNodeIdsByEditScriptId } = assetExecution
  const segmentByIdentity = new Map(videoSegments.map((segment) => [
    `${segment.editScriptId}:${segment.segmentId}`,
    segment,
  ]))
  const projectedVideoPlans = editFirstCanvasVisibility.videoPlan
    ? projectedEditScripts.flatMap((script) => script.generationSegments.map((segment, segmentIndex) => ({
        script,
        segment,
        segmentIndex,
        videoSegment: segmentByIdentity.get(`${script.id}:${segment.segmentId}`) ?? null,
      })))
    : []
  const startY = Math.max(
    maxNodeBottomY(nodes, 'editShotExecutionPlan') ?? STAGE_START_Y,
    maxNodeBottomY(nodes, 'editAssetGroup') ?? STAGE_START_Y,
  ) + 160

  projectedVideoPlans.forEach(({ script, segment, segmentIndex, videoSegment }, projectionIndex) => {
    const chapterId = script.chapterId
    if (!chapterId) throw new Error(`VIDEO_SEGMENT_CHAPTER_REQUIRED:${script.id}`)
    if (videoSegment && videoSegment.id !== segment.videoSegmentId) {
      throw new Error(`VIDEO_SEGMENT_VIEW_IDENTITY_MISMATCH:${videoSegment.id}:${segment.videoSegmentId}`)
    }
    const shots = segment.shotIds.map((shotId) => {
      const shot = script.shots.find((candidate) => candidate.shotId === shotId)
      if (!shot) throw new Error(`VIDEO_SEGMENT_SHOT_UNKNOWN:${script.id}:${segment.segmentId}:${shotId}`)
      return shot
    })
    const nodeId = workspaceNodeId.videoPlan(script.id, segmentIndex + 1)
    const actionAvailable = editFirstWorkflow.operationPolicy.allowedOperationIds.includes('generate_video_segments')
    nodes.push(createMediaNode({
      id: nodeId,
      position: layoutPosition(savedLayouts, nodeId, {
        x: SHOT_GRID_START_X + (projectionIndex % VIDEO_PLAN_GRID_COLUMNS)
          * (WORKSPACE_CANVAS_VIDEO_PLAN_NODE_SIZE.width + SHOT_GRID_GAP_X),
        y: startY + Math.floor(projectionIndex / VIDEO_PLAN_GRID_COLUMNS)
          * (WORKSPACE_CANVAS_VIDEO_PLAN_NODE_SIZE.height + VIDEO_PLAN_GRID_GAP_Y),
      }),
      width: WORKSPACE_CANVAS_VIDEO_PLAN_NODE_SIZE.width,
      height: WORKSPACE_CANVAS_VIDEO_PLAN_NODE_SIZE.height,
      loadingContext: { styleImageUrl: stylePreviewImageUrl },
      data: {
        projectId,
        episodeName,
        kind: 'videoPlan',
        layoutNodeType: 'videoPlan',
        targetType: 'videoSegment',
        targetId: segment.videoSegmentId,
        title: translate('nodes.videoPlan.title', { index: projectionIndex + 1 }),
        eyebrow: translate('nodes.videoPlan.eyebrow'),
        body: segment.continuity,
        meta: translate('nodes.videoPlan.meta', {
          mode: translate('nodeFields.videoPlanGroup'),
          shots: shots.length,
          duration: shots.reduce((sum, shot) => sum + shot.durationSec, 0),
        }),
        ...(videoSegment
          ? resourcePresentationFromStatus(videoSegment.status) ?? workspaceCanvasPendingResourcePresentation()
          : workspaceCanvasPendingResourcePresentation()),
        runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectVideoSegment(segment.videoSegmentId)),
        ...(actionAvailable
          ? {
              actionLabel: translate(videoSegment?.videoMedia ? 'actions.regenerateVideo' : 'actions.generateVideo'),
              action: {
                type: 'generate_video_segments' as const,
                scope: {
                  kind: 'segment' as const,
                  chapterId,
                  editScriptId: script.id,
                  segmentId: segment.segmentId,
                },
              },
            }
          : {}),
        previewImageUrl: null,
        previewAspectRatio: outputAspectRatio(videoSegment),
        videoPlanDetails: {
          editScriptId: script.id,
          chapterId,
          segmentId: segment.segmentId,
          segmentIndex,
          videoSegmentId: segment.videoSegmentId,
          shotIds: segment.shotIds,
          shotNumbers: shots.map((shot) => shot.shotNumber),
          durationSec: shots.reduce((sum, shot) => sum + shot.durationSec, 0),
          continuity: segment.continuity,
          outputUrl: videoSegment?.videoMedia?.url ?? null,
          outputAspectRatio: outputAspectRatio(videoSegment),
          errorMessage: videoSegment?.errorMessage ?? null,
        },
        onAction,
      },
    }))
    const sourceNodeId = executionNodeIdsByEditScriptId.get(script.id) ?? executionNodeId ?? editScriptNodeId
    if (sourceNodeId) edges.push(createEdge(`edge:${sourceNodeId}:${nodeId}`, sourceNodeId, nodeId))
  })

  const bottom = maxNodeBottomY(nodes, 'videoPlan') ?? startY
  return {
    projectedVideoPlans,
    bgmScoreDefaultY: bottom + 160,
  }
}
