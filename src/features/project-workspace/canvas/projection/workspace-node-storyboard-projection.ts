import type { ProjectEditAssetRequirement, ProjectEditScript, ProjectEditScriptShot, ProjectPanel, ProjectVideoGroup } from '@/types/project'
import type { WorkspaceCanvasAssetRef, WorkspaceCanvasImageDetails, WorkspaceCanvasShotDetails, WorkspaceCanvasVideoPlanDetails } from '../node-canvas-types'
import type { WorkspaceNodeProjectionContext } from './workspace-node-projection-shared'
import type { WorkspacePlanningProjection } from './workspace-node-planning-projection'
import type { WorkspaceAssetExecutionProjection } from './workspace-node-asset-execution-projection'
import {
  SHOT_GRID_COLUMNS,
  SHOT_GRID_GAP_X,
  SHOT_GRID_GAP_Y,
  SHOT_GRID_START_X,
  SHOT_GRID_START_Y,
  STAGE_START_Y,
  TASK_RUNTIME_TARGETS,
  VIDEO_PLAN_GRID_COLUMNS,
  VIDEO_PLAN_GRID_GAP_Y,
  WORKSPACE_CANVAS_SHOT_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_COLLAPSED_NODE_SIZE,
  WORKSPACE_CANVAS_VIDEO_PLAN_NODE_SIZE,
  assetPreviewUrl,
  collectPanels,
  createEdge,
  createMediaNode,
  layoutPosition,
  maxNodeBottomY,
  parseJsonRecord,
  parseStringList,
  primaryPanelImageUrl,
  readShotIds,
  resolvePanelShotId,
  resolvePanelShotNumber,
  resourcePresentationFromStatus,
  runtimeTargets,
  workspaceCanvasFailedResourcePresentation,
  workspaceCanvasPendingResourcePresentation,
  workspaceCanvasSucceededResourcePresentation,
  workspaceNodeId,
} from './workspace-node-projection-shared'

const DOWNSTREAM_STAGE_GAP_Y = 160

interface CanvasGridPositionInput {
  readonly index: number
  readonly columns: number
  readonly startX: number
  readonly startY: number
  readonly itemWidth: number
  readonly columnGapX: number
  readonly rowStepY: number
}

export interface ProjectedWorkspaceVideoPlan {
  readonly script: ProjectEditScript
  readonly segment: ProjectEditScript['generationSegments'][number]
  readonly segmentIndex: number
}

export interface WorkspaceStoryboardProjection {
  readonly panelList: ReturnType<typeof collectPanels>
  readonly projectedVideoPlans: readonly ProjectedWorkspaceVideoPlan[]
  readonly bgmScoreDefaultY: number
}

function sameShotIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((shotId, index) => shotId === right[index])
}

function mediaAspectRatio(media: ProjectPanel['media']): number | null {
  if (!media) return null
  if (typeof media.width !== 'number' || typeof media.height !== 'number') return null
  if (!Number.isFinite(media.width) || !Number.isFinite(media.height)) return null
  if (media.width <= 0 || media.height <= 0) return null
  return media.width / media.height
}

function gridRowCount(itemCount: number, columns: number): number {
  if (itemCount <= 0) return 0
  return Math.ceil(itemCount / columns)
}

function gridPosition(input: CanvasGridPositionInput): { readonly x: number; readonly y: number } {
  const column = input.index % input.columns
  const row = Math.floor(input.index / input.columns)
  return {
    x: input.startX + column * (input.itemWidth + input.columnGapX),
    y: input.startY + row * input.rowStepY,
  }
}

function gridBottomY(input: {
  readonly itemCount: number
  readonly columns: number
  readonly startY: number
  readonly itemHeight: number
  readonly rowStepY: number
}): number | null {
  const rows = gridRowCount(input.itemCount, input.columns)
  if (rows === 0) return null
  return input.startY + (rows - 1) * input.rowStepY + input.itemHeight
}

function defaultStoryboardBottomY(visibleStoryboardPanelCount: number): number {
  return (
    gridBottomY({
      itemCount: visibleStoryboardPanelCount,
      columns: SHOT_GRID_COLUMNS,
      startY: SHOT_GRID_START_Y,
      itemHeight: WORKSPACE_CANVAS_SHOT_NODE_SIZE.height,
      rowStepY: SHOT_GRID_GAP_Y,
    }) ?? STAGE_START_Y + WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_COLLAPSED_NODE_SIZE.height
  )
}

function nextDefaultStageY(previousStageBottomY: number): number {
  return previousStageBottomY + DOWNSTREAM_STAGE_GAP_Y
}

function videoGroupForShotIds(videoGroups: readonly ProjectVideoGroup[], shotIds: readonly string[]): ProjectVideoGroup | null {
  return videoGroups.find((group) => sameShotIds(readShotIds(group.shotIds), shotIds)) ?? null
}

function inferGridMode(shotCount: number): '2x2' | '3x3' | undefined {
  if (shotCount >= 2 && shotCount <= 4) return '2x2'
  if (shotCount >= 5 && shotCount <= 9) return '3x3'
  return undefined
}

function shotAssetRefs(panel: ProjectPanel): WorkspaceCanvasAssetRef[] {
  return parseStringList(panel.characters).map((name) => ({ name }))
}

function shotDetails(panel: ProjectPanel): WorkspaceCanvasShotDetails {
  return {
    shotType: panel.shotType,
    cameraMove: panel.cameraMove,
    characters: shotAssetRefs(panel),
    location: panel.location,
    props: parseStringList(panel.props),
    srtSegment: panel.srtSegment,
    timeRange: panel.srtStart !== null && panel.srtEnd !== null ? `${panel.srtStart} - ${panel.srtEnd}` : null,
    duration: panel.duration,
    imagePrompt: panel.imagePrompt,
    videoPrompt: panel.videoPrompt,
    executionSnapshot: parseJsonRecord(panel.executionSnapshotJson),
    renderFacts: parseJsonRecord(panel.renderFactsJson),
    actingNotes: panel.actingNotes,
    storyboardTextJson: null,
    errorMessage: panel.imageErrorMessage ?? panel.videoErrorMessage ?? null,
  }
}

function imageDetails(panel: ProjectPanel): WorkspaceCanvasImageDetails {
  return {
    imagePrompt: panel.imagePrompt,
    description: panel.description,
    candidateImages: parseStringList(panel.candidateImages),
    errorMessage: panel.imageErrorMessage ?? null,
  }
}

function videoPlanDetails(input: {
  readonly editScript: ProjectEditScript
  readonly segmentIndex: number
  readonly videoGroup: ProjectVideoGroup | null
  readonly panelsByShot: ReadonlyMap<string, ProjectPanel>
  readonly requirements: readonly ProjectEditAssetRequirement[]
  readonly defaultVideoModel?: string | null
}): WorkspaceCanvasVideoPlanDetails {
  const segment = input.editScript.generationSegments[input.segmentIndex]
  if (!segment) throw new Error(`GENERATION_SEGMENT_MISSING:${input.segmentIndex}`)
  const segmentShots = segment.shotIds
    .map((shotId) => input.editScript.shots.find((candidate) => candidate.shotId === shotId))
    .filter((shot): shot is ProjectEditScriptShot => Boolean(shot))
  const shotNumbers = segmentShots.map((shot) => shot.shotNumber)
  const durationSec = segment.shotIds.reduce((total, shotId) => {
    const shot = input.editScript.shots.find((candidate) => candidate.shotId === shotId)
    return total + (shot?.durationSec ?? 0)
  }, 0)
  const sourceImages = segment.shotIds.map((shotId, index) => {
    const panel = input.panelsByShot.get(shotId) ?? null
    return {
      panelId: panel?.id ?? null,
      storyboardId: panel?.storyboardId ?? null,
      panelIndex: panel?.panelIndex ?? null,
      shotNumber: shotNumbers[index] ?? index + 1,
      imageUrl: primaryPanelImageUrl(panel),
      aspectRatio: null,
    }
  })
  const chapterId = input.editScript.chapterId?.trim()
  if (!chapterId) throw new Error(`VIDEO_PLAN_CHAPTER_SCOPE_REQUIRED:${input.editScript.id}`)
  return {
    editScriptId: input.editScript.id,
    chapterId,
    segmentIndex: input.segmentIndex,
    kind: 'group',
    videoGroupId: input.videoGroup?.id ?? null,
    shotNumbers,
    shotIds: segment.shotIds,
    durationSec,
    gridMode: inferGridMode(segment.shotIds.length),
    continuity: segment.continuity,
    prompt: input.videoGroup?.prompt ?? null,
    assetReferenceVideoModel: input.defaultVideoModel ?? null,
    outputUrl: input.videoGroup?.videoMedia?.url ?? input.videoGroup?.videoUrl ?? null,
    outputAspectRatio: null,
    errorMessage: input.videoGroup?.errorMessage ?? null,
    sourceImages,
    assetReferences: input.requirements
      .filter((requirement) => requirement.shotIds.some((shotId) => segment.shotIds.includes(shotId)))
      .map((requirement) => ({
        id: requirement.id,
        name: requirement.name,
        kind: requirement.kind,
        imageUrl: assetPreviewUrl(requirement),
        shotNumbers: requirement.shotIds
          .map((shotId) => input.editScript.shots.find((shot) => shot.shotId === shotId)?.shotNumber ?? null)
          .filter((value): value is number => typeof value === 'number'),
        shotIds: requirement.shotIds,
      })),
    validationMessage: null,
  }
}

export function appendWorkspaceStoryboardProjection(
  context: WorkspaceNodeProjectionContext,
  planning: WorkspacePlanningProjection,
  assetExecution: WorkspaceAssetExecutionProjection,
): WorkspaceStoryboardProjection {
  const {
    projectId,
    episodeName,
    storyboards,
    videoGroups,
    defaultVideoModel,
    defaultSequenceVideoModel,
    savedLayouts,
    translate,
    onAction,
    nodes,
    edges,
    panelsByShot,
    projectedEditScripts,
    editFirstCanvasVisibility,
    stylePreviewImageUrl,
    stylePreviewAspectRatio,
  } = context
  const { editScriptNodeId, editScriptNodeIdsByScriptId } = planning
  const { executionNodeId, executionNodeIdsByEditScriptId } = assetExecution

  const panelList = collectPanels(storyboards)
  const shotNodeIdsByShotId = new Map<string, string>()
  const storyboardSourceNodeId = executionNodeId ?? editScriptNodeId
  const storyboardEditScriptIdById = new Map(
    storyboards.flatMap((storyboard) => (storyboard.editScriptId ? [[storyboard.id, storyboard.editScriptId] as const] : [])),
  )
  const visibleStoryboardPanelCount = editFirstCanvasVisibility.storyboardPanels && storyboardSourceNodeId ? panelList.length : 0
  if (editFirstCanvasVisibility.storyboardPanels && storyboardSourceNodeId) {
    panelList.forEach((panel, index) => {
      const shotNumber = resolvePanelShotNumber(panel)
      const shotId = resolvePanelShotId(panel)
      const nodeId = workspaceNodeId.shot(panel.id)
      shotNodeIdsByShotId.set(shotId, nodeId)
      const previewImageUrl = primaryPanelImageUrl(panel)
      const previewAspectRatio = mediaAspectRatio(panel.media) ?? stylePreviewAspectRatio
      const shotFailed = Boolean(panel.imageErrorMessage || panel.videoErrorMessage)
      const shotPresentation = shotFailed
        ? workspaceCanvasFailedResourcePresentation()
        : previewImageUrl
          ? workspaceCanvasSucceededResourcePresentation()
          : workspaceCanvasPendingResourcePresentation()
      nodes.push(
        createMediaNode({
          id: nodeId,
          position: layoutPosition(
            savedLayouts,
            nodeId,
            gridPosition({
              index,
              columns: SHOT_GRID_COLUMNS,
              startX: SHOT_GRID_START_X,
              startY: SHOT_GRID_START_Y,
              itemWidth: WORKSPACE_CANVAS_SHOT_NODE_SIZE.width,
              columnGapX: SHOT_GRID_GAP_X,
              rowStepY: SHOT_GRID_GAP_Y,
            }),
          ),
          width: WORKSPACE_CANVAS_SHOT_NODE_SIZE.width,
          height: WORKSPACE_CANVAS_SHOT_NODE_SIZE.height,
          loadingContext: { styleImageUrl: stylePreviewImageUrl },
          data: {
            projectId,
            episodeName,
            kind: 'shot',
            layoutNodeType: 'shot',
            targetType: 'panel',
            targetId: panel.id,
            storyboardId: panel.storyboardId,
            panelIndex: panel.panelIndex,
            title: translate('nodes.shot.title', { shot: shotNumber }),
            eyebrow: translate('nodes.shot.eyebrow'),
            body: panel.description ?? translate('empty.panel'),
            meta: panel.location ?? translate('empty.location'),
            ...shotPresentation,
            previewImageUrl,
            previewAspectRatio,
            runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectPanelImageOperations(panel.id), TASK_RUNTIME_TARGETS.projectPanelVideo(panel.id)),
            actionLabel: translate(previewImageUrl ? 'actions.regenerateImage' : 'actions.generateImage'),
            action: { type: 'generate_image', panelId: panel.id },
            shotDetails: shotDetails(panel),
            imageDetails: imageDetails(panel),
            videoDetails: {
              videoPrompt: panel.videoPrompt,
              lastVideoGenerationOptions: [],
              videoUrl: panel.videoMedia?.url ?? panel.videoUrl,
              videoModel: panel.videoModel,
              errorMessage: panel.videoErrorMessage ?? null,
            },
            onAction,
          },
        }),
      )
      const panelEditScriptId = storyboardEditScriptIdById.get(panel.storyboardId) ?? null
      const panelSourceNodeId = panelEditScriptId
        ? (executionNodeIdsByEditScriptId.get(panelEditScriptId) ?? editScriptNodeIdsByScriptId.get(panelEditScriptId) ?? storyboardSourceNodeId)
        : storyboardSourceNodeId
      edges.push(createEdge(`edge:${panelSourceNodeId}:${nodeId}`, panelSourceNodeId, nodeId))
    })
  }
  const storyboardStageBottomY = maxNodeBottomY(nodes, 'shot') ?? defaultStoryboardBottomY(visibleStoryboardPanelCount)
  const videoPlanStartY = nextDefaultStageY(storyboardStageBottomY)
  const projectedVideoPlans = editFirstCanvasVisibility.videoPlan
    ? projectedEditScripts.flatMap((script) =>
        script.generationSegments.map((segment, segmentIndex) => ({
          script,
          segment,
          segmentIndex,
        })),
      )
    : []

  projectedVideoPlans.forEach(({ script, segment, segmentIndex }, projectionIndex) => {
    const nodeId = workspaceNodeId.videoPlan(script.id, segmentIndex + 1)
    const videoGroup = videoGroupForShotIds(videoGroups, segment.shotIds)
    const details = videoPlanDetails({
      editScript: script,
      segmentIndex,
      videoGroup,
      panelsByShot,
      requirements: script.requirements,
      defaultVideoModel: defaultSequenceVideoModel ?? defaultVideoModel,
    })
    const gridMode = inferGridMode(segment.shotIds.length)
    const canGenerateGroup = Boolean(gridMode && details.sourceImages.every((image) => Boolean(image.imageUrl)))
    const videoGroupPresentation = videoGroup ? (resourcePresentationFromStatus(videoGroup.status) ?? workspaceCanvasPendingResourcePresentation()) : null
    nodes.push(
      createMediaNode({
        id: nodeId,
        position: layoutPosition(
          savedLayouts,
          nodeId,
          gridPosition({
            index: projectionIndex,
            columns: VIDEO_PLAN_GRID_COLUMNS,
            startX: SHOT_GRID_START_X,
            startY: videoPlanStartY,
            itemWidth: WORKSPACE_CANVAS_VIDEO_PLAN_NODE_SIZE.width,
            columnGapX: SHOT_GRID_GAP_X,
            rowStepY: WORKSPACE_CANVAS_VIDEO_PLAN_NODE_SIZE.height + VIDEO_PLAN_GRID_GAP_Y,
          }),
        ),
        width: WORKSPACE_CANVAS_VIDEO_PLAN_NODE_SIZE.width,
        height: WORKSPACE_CANVAS_VIDEO_PLAN_NODE_SIZE.height,
        loadingContext: { styleImageUrl: stylePreviewImageUrl },
        data: {
          projectId,
          episodeName,
          kind: 'videoPlan',
          layoutNodeType: 'videoPlan',
          targetType: 'videoGroup',
          targetId: videoGroup?.id ?? `${script.id}:generationSegment:${segmentIndex + 1}`,
          title: translate('nodes.videoPlan.title', { index: projectionIndex + 1 }),
          eyebrow: translate('nodes.videoPlan.eyebrow'),
          body: segment.continuity,
          meta: translate('nodes.videoPlan.meta', {
            mode: translate('nodeFields.videoPlanGroup'),
            shots: segment.shotIds.length,
            duration: details.durationSec,
          }),
          ...(videoGroupPresentation ?? workspaceCanvasPendingResourcePresentation()),
          runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectVideoGroup(videoGroup?.id ?? null)),
          actionLabel: canGenerateGroup ? translate(details.outputUrl ? 'actions.regenerateVideo' : 'actions.generateVideo') : undefined,
          action:
            canGenerateGroup && gridMode
              ? {
                  type: 'generate_video_group',
                  chapterId: details.chapterId,
                  gridMode,
                  shotIds: segment.shotIds,
                }
              : undefined,
          videoPlanDetails: details,
          onAction,
        },
      }),
    )
    segment.shotIds.forEach((shotId) => {
      const shotNodeId = shotNodeIdsByShotId.get(shotId)
      if (shotNodeId) edges.push(createEdge(`edge:${shotNodeId}:${nodeId}:${shotId}`, shotNodeId, nodeId))
    })
    const sourceExecutionNodeId = executionNodeIdsByEditScriptId.get(script.id) ?? executionNodeId
    if (!segment.shotIds.some((shotId) => shotNodeIdsByShotId.has(shotId)) && sourceExecutionNodeId) {
      edges.push(createEdge(`edge:${sourceExecutionNodeId}:${nodeId}`, sourceExecutionNodeId, nodeId))
    }
  })
  const videoPlanStageBottomY = maxNodeBottomY(nodes, 'videoPlan')
  const bgmScoreDefaultY = nextDefaultStageY(Math.max(storyboardStageBottomY, videoPlanStageBottomY ?? storyboardStageBottomY))

  return { panelList, projectedVideoPlans, bgmScoreDefaultY }
}
