import type { CSSProperties } from 'react'
import type { CanvasNodeLayout } from '@/lib/project-canvas/layout/canvas-layout.types'
import type { CreativeResourceCardView } from '@/lib/creative-resource/contracts'
import { buildEditStylePreviewSetView } from '@/lib/edit-script/style-preview-set-view'
import { TASK_RUNTIME_TARGETS, type TaskRuntimeTarget } from '@/lib/task/runtime-targets'
import type {
  Character,
  Location,
  ProjectEditAssetRequirement,
  ProjectEditBible,
  ProjectEditScript,
  ProjectEditShotExecutionPlan,
  ProjectFinalVideo,
  ProjectVideoSegment,
} from '@/types/project'
import type {
  WorkspaceCanvasFlowEdge,
  WorkspaceCanvasFlowNode,
  MediaLoadingContext,
  WorkspaceCanvasMediaNodeKind,
  WorkspaceCanvasMediaNodeData,
  WorkspaceCanvasNodeActionHandler,
  WorkspaceCanvasNodeData,
  WorkspaceCanvasNodeRecord,
} from '../node-canvas-types'

type WorkspaceCanvasNodeInputBase = Omit<WorkspaceCanvasNodeData, 'nodeId' | 'width' | 'height' | 'kind' | 'mediaLoadingContext'>

type WorkspaceCanvasNodeInputData = WorkspaceCanvasNodeInputBase &
  (
    | {
        readonly kind: WorkspaceCanvasMediaNodeKind
        readonly mediaLoadingContext: MediaLoadingContext
      }
    | {
        readonly kind: Exclude<WorkspaceCanvasNodeData['kind'], WorkspaceCanvasMediaNodeKind>
        readonly mediaLoadingContext?: never
      }
  )

type WorkspaceCanvasMediaNodeInputData = Omit<WorkspaceCanvasMediaNodeData, 'nodeId' | 'width' | 'height' | 'mediaLoadingContext'>
import {
  WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE,
  WORKSPACE_CANVAS_DEFAULT_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_COLLAPSED_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_BIBLE_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_SCRIPT_TO_ASSET_GAP_Y,
  WORKSPACE_CANVAS_EDIT_STYLE_BIBLE_NODE_SIZE,
  WORKSPACE_CANVAS_VIDEO_PLAN_NODE_SIZE,
} from '../node-presentation-profiles'
import { workspaceNodeId } from '../workspace-canvas-node-ids'
import { resolveWorkspaceCanvasNodeMaterialization } from '../registry/workspace-canvas-node-registry'
import type { WorkspaceCanvasStreamTarget } from '../structured-stream/workspace-structured-stream-runtime-types'
import {
  workspaceCanvasFailedResourcePresentation,
  workspaceCanvasPendingResourcePresentation,
  workspaceCanvasResourcePhaseFromStatus,
  workspaceCanvasResourcePresentation,
  workspaceCanvasSucceededResourcePresentation,
} from '../lifecycle/workspace-canvas-resource-lifecycle'

interface TranslateValues {
  readonly [key: string]: string | number
}

type Translate = (key: string, values?: TranslateValues) => string

interface WorkspaceCanvasActiveTaskTarget extends TaskRuntimeTarget {
  readonly taskId: string
  readonly sourceKind?: string | null
}

export interface BuildWorkspaceNodeCanvasProjectionInput {
  readonly projectId?: string
  readonly episodeId: string
  readonly episodeName?: string
  readonly editBible?: ProjectEditBible | null
  readonly editScript?: ProjectEditScript | null
  readonly editScripts?: readonly ProjectEditScript[]
  readonly editShotExecutionPlans?: readonly ProjectEditShotExecutionPlan[]
  readonly projectCharacters?: readonly Character[]
  readonly projectLocations?: readonly Location[]
  readonly activeTaskTargets?: readonly WorkspaceCanvasActiveTaskTarget[]
  readonly editScriptPending?: boolean
  readonly streamTargets?: readonly WorkspaceCanvasStreamTarget[]
  readonly finalVideo?: ProjectFinalVideo | null
  readonly videoSegments?: readonly ProjectVideoSegment[]
  readonly defaultVideoModel?: string | null
  readonly creativeResources?: readonly CreativeResourceCardView[]
  readonly savedLayouts: readonly CanvasNodeLayout[]
  readonly translate: Translate
  readonly onAction?: WorkspaceCanvasNodeActionHandler
}

type JsonRecord = Record<string, unknown>

const STORY_COLUMN_X = 260
const COLUMN_GAP_X = 900
const ROW_GAP_Y = 170
const SHOT_GRID_COLUMNS = 5
const VIDEO_PLAN_GRID_COLUMNS = SHOT_GRID_COLUMNS
const SHOT_GRID_GAP_X = 44
const SHOT_GRID_GAP_Y = 820
const STAGE_START_Y = 120
const SHOT_GRID_START_Y = 460
const VIDEO_PLAN_GRID_GAP_Y = 96
const ASSET_GROUP_Y_OFFSET = WORKSPACE_CANVAS_EDIT_SCRIPT_TO_ASSET_GAP_Y
const SHOT_GRID_START_X = STORY_COLUMN_X + COLUMN_GAP_X * 3

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readJsonRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null
}

function parseJsonRecord(value: unknown): JsonRecord | null {
  if (isRecord(value)) return value
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return readJsonRecord(parsed)
  } catch {
    return null
  }
}

function runtimeTargets(...targets: Array<TaskRuntimeTarget | null>): readonly TaskRuntimeTarget[] {
  return targets.filter((target): target is TaskRuntimeTarget => target !== null)
}

function hasStreamTarget(targets: readonly WorkspaceCanvasStreamTarget[], streamKind: WorkspaceCanvasStreamTarget['streamKind'], targetId: string): boolean {
  return targets.some((target) => target.streamKind === streamKind && target.targetId === targetId)
}

function findStreamTarget(
  targets: readonly WorkspaceCanvasStreamTarget[],
  streamKind: WorkspaceCanvasStreamTarget['streamKind'],
  episodeId: string,
): WorkspaceCanvasStreamTarget | null {
  return targets.find((target) => target.streamKind === streamKind && (target.episodeId === null || target.episodeId === episodeId)) ?? null
}

function resourcePresentationFromStatus(status: string | null | undefined) {
  const phase = workspaceCanvasResourcePhaseFromStatus(status)
  return phase ? workspaceCanvasResourcePresentation(phase) : null
}

function stylePreviewAspectRatioValue(value: '9:16' | '16:9' | '21:9' | null | undefined): number | null {
  switch (value) {
    case '9:16':
      return 9 / 16
    case '16:9':
      return 16 / 9
    case '21:9':
      return 21 / 9
    default:
      return null
  }
}

function confirmedStylePreviewAspectRatio(bible: ProjectEditBible | null | undefined): number | null {
  const confirmed = bible?.stylePreviews?.find((preview) => preview.status === 'confirmed') ?? null
  const fallback = bible?.stylePreviews?.[0] ?? null
  return stylePreviewAspectRatioValue(confirmed?.aspectRatio ?? fallback?.aspectRatio)
}

function nodeBottomY(node: WorkspaceCanvasFlowNode): number {
  return node.position.y + node.data.height
}

function maxNodeBottomY(nodes: readonly WorkspaceCanvasFlowNode[], kind: WorkspaceCanvasFlowNode['data']['kind']): number | null {
  const matchingBottoms = nodes.filter((node) => node.data.kind === kind).map((node) => nodeBottomY(node))
  return matchingBottoms.length > 0 ? Math.max(...matchingBottoms) : null
}

function confirmedStylePreviewImageUrl(bible: ProjectEditBible | null | undefined): string | null {
  return bible?.stylePreviews?.find((preview) => preview.status === 'confirmed' && Boolean(stringValue(preview.imageUrl)))?.imageUrl ?? null
}

function assetPreviewUrl(requirement: ProjectEditAssetRequirement): string | null {
  return requirement.previewImageUrl ?? null
}

function styleForNode(width: number, height: number): CSSProperties {
  return { width, height }
}

function layoutPosition(
  savedLayouts: readonly CanvasNodeLayout[],
  nodeId: string,
  fallback: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } {
  const saved = savedLayouts.find((layout) => layout.nodeKey === nodeId)
  return saved ? { x: saved.x, y: saved.y } : fallback
}

function createEdge(id: string, source: string, target: string): WorkspaceCanvasFlowEdge {
  return {
    id,
    source,
    target,
    type: 'smoothstep',
    animated: false,
  }
}

function normalizeMediaLoadingContext(value: unknown): MediaLoadingContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const styleImageUrl = Reflect.get(value, 'styleImageUrl')
  if (styleImageUrl !== null && typeof styleImageUrl !== 'string') return null
  return { styleImageUrl }
}

function createNode(input: {
  readonly id: string
  readonly position: { readonly x: number; readonly y: number }
  readonly data: WorkspaceCanvasNodeInputData
  readonly width: number
  readonly height: number
}): WorkspaceCanvasFlowNode {
  const data: WorkspaceCanvasNodeRecord = {
    ...input.data,
    mediaLoadingContext: normalizeMediaLoadingContext(input.data.mediaLoadingContext),
    nodeId: input.id,
    width: input.width,
    height: input.height,
    layoutBasePosition: input.position,
  }
  return {
    id: input.id,
    type: 'workspaceNode',
    position: input.position,
    style: styleForNode(input.width, input.height),
    data,
  }
}

function createMediaNode(input: {
  readonly id: string
  readonly position: { readonly x: number; readonly y: number }
  readonly data: WorkspaceCanvasMediaNodeInputData
  readonly loadingContext: { readonly styleImageUrl: string | null }
  readonly width: number
  readonly height: number
}): WorkspaceCanvasFlowNode {
  return createNode({
    id: input.id,
    position: input.position,
    width: input.width,
    height: input.height,
    data: {
      ...input.data,
      mediaLoadingContext: input.loadingContext,
    },
  })
}

export function createWorkspaceNodeProjectionContext(input: BuildWorkspaceNodeCanvasProjectionInput) {
  const {
    projectId,
    episodeId,
    episodeName,
    editBible = null,
    editScript = null,
    editScripts = [],
    editShotExecutionPlans = [],
    projectCharacters = [],
    projectLocations = [],
    activeTaskTargets = [],
    editScriptPending = false,
    streamTargets = [],
    finalVideo = null,
    videoSegments = [],
    defaultVideoModel = null,
    creativeResources = [],
    savedLayouts,
    translate,
    onAction,
  } = input

  const nodes: WorkspaceCanvasFlowNode[] = []
  const edges: WorkspaceCanvasFlowEdge[] = []
  const projectedEditScripts = editScripts.length > 0 ? editScripts : editScript ? [editScript] : []
  const chapterIndexById = new Map((editBible?.chapters ?? []).map((chapter) => [chapter.id, chapter.chapterIndex] as const))
  const stylePreviewSetView = buildEditStylePreviewSetView({
    previews: editBible?.stylePreviews ?? [],
  })
  const stylePreviewImageUrl = confirmedStylePreviewImageUrl(editBible)
  const stylePreviewAspectRatio = confirmedStylePreviewAspectRatio(editBible)

  return {
    projectId,
    episodeId,
    episodeName,
    editBible,
    editScript,
    editScripts,
    editShotExecutionPlans,
    projectCharacters,
    projectLocations,
    activeTaskTargets,
    editScriptPending,
    streamTargets,
    finalVideo,
    videoSegments,
    defaultVideoModel,
    creativeResources,
    savedLayouts,
    translate,
    onAction,
    nodes,
    edges,
    projectedEditScripts,
    chapterIndexById,
    stylePreviewSetView,
    stylePreviewImageUrl,
    stylePreviewAspectRatio,
  }
}

export type WorkspaceNodeProjectionContext = ReturnType<typeof createWorkspaceNodeProjectionContext>

export {
  ASSET_GROUP_Y_OFFSET,
  COLUMN_GAP_X,
  ROW_GAP_Y,
  SHOT_GRID_COLUMNS,
  SHOT_GRID_GAP_X,
  SHOT_GRID_GAP_Y,
  SHOT_GRID_START_X,
  SHOT_GRID_START_Y,
  STAGE_START_Y,
  STORY_COLUMN_X,
  VIDEO_PLAN_GRID_COLUMNS,
  VIDEO_PLAN_GRID_GAP_Y,
  WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE,
  WORKSPACE_CANVAS_DEFAULT_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_BIBLE_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_COLLAPSED_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_STYLE_BIBLE_NODE_SIZE,
  WORKSPACE_CANVAS_VIDEO_PLAN_NODE_SIZE,
  TASK_RUNTIME_TARGETS,
  assetPreviewUrl,
  createEdge,
  createMediaNode,
  createNode,
  findStreamTarget,
  hasStreamTarget,
  layoutPosition,
  maxNodeBottomY,
  parseJsonRecord,
  readJsonRecord,
  resolveWorkspaceCanvasNodeMaterialization,
  resourcePresentationFromStatus,
  runtimeTargets,
  stringValue,
  workspaceCanvasFailedResourcePresentation,
  workspaceCanvasPendingResourcePresentation,
  workspaceCanvasSucceededResourcePresentation,
  workspaceNodeId,
}
