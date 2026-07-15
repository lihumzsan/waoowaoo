import type { WorkspaceCanvasFlowEdge, WorkspaceCanvasFlowNode, WorkspaceCanvasNodeKind } from '../node-canvas-types'

export type WorkspaceCanvasLayoutLane =
  | 'story'
  | 'editPipeline'
  | 'editScript'
  | 'assets'
  | 'execution'
  | 'videoPlan'
  | 'bgm'
  | 'final'

export type WorkspaceCanvasAnchorMode = 'none' | 'fixed' | 'manual'

export interface WorkspaceCanvasLayoutPosition {
  readonly x: number
  readonly y: number
}

export interface WorkspaceCanvasLayoutSize {
  readonly width: number
  readonly height: number
}

export interface WorkspaceCanvasLayoutModelNode {
  readonly id: string
  readonly kind: WorkspaceCanvasNodeKind
  readonly targetType: WorkspaceCanvasFlowNode['data']['targetType']
  readonly targetId: string
  readonly lane: WorkspaceCanvasLayoutLane
  readonly groupId: string
  readonly order: number
  readonly estimatedSize: WorkspaceCanvasLayoutSize
  readonly measuredSize?: WorkspaceCanvasLayoutSize
  readonly basePosition: WorkspaceCanvasLayoutPosition
  readonly anchorMode: WorkspaceCanvasAnchorMode
}

export interface WorkspaceCanvasLayoutModelEdge {
  readonly id: string
  readonly source: string
  readonly target: string
}

export interface WorkspaceCanvasLayoutModel {
  readonly nodes: readonly WorkspaceCanvasLayoutModelNode[]
  readonly layoutEdges: readonly WorkspaceCanvasLayoutModelEdge[]
}

export interface BuildWorkspaceCanvasLayoutModelInput {
  readonly nodes: readonly WorkspaceCanvasFlowNode[]
  readonly layoutEdges?: readonly WorkspaceCanvasFlowEdge[]
  readonly measuredNodeSizes?: ReadonlyMap<string, WorkspaceCanvasLayoutSize>
  readonly fixedAnchorPositions?: ReadonlyMap<string, WorkspaceCanvasLayoutPosition>
  readonly manualAnchorPositions?: ReadonlyMap<string, WorkspaceCanvasLayoutPosition>
}

function numericStyleDimension(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function isWorkspaceCanvasLayoutPosition(value: unknown): value is WorkspaceCanvasLayoutPosition {
  if (typeof value !== 'object' || value === null) return false
  const record = value as { readonly x?: unknown; readonly y?: unknown }
  return typeof record.x === 'number' && Number.isFinite(record.x)
    && typeof record.y === 'number' && Number.isFinite(record.y)
}

function estimatedNodeSize(node: WorkspaceCanvasFlowNode): WorkspaceCanvasLayoutSize {
  return {
    width: numericStyleDimension(node.style?.width) ?? node.data.width,
    height: numericStyleDimension(node.style?.height) ?? node.data.height,
  }
}

export function resolveWorkspaceCanvasLayoutLane(kind: WorkspaceCanvasNodeKind): WorkspaceCanvasLayoutLane {
  switch (kind) {
    case 'editSourceScript':
    case 'editBible':
    case 'editStyleBible':
      return 'story'
    case 'editPipelineStep':
    case 'editProcessGroup':
      return 'editPipeline'
    case 'editScript':
      return 'editScript'
    case 'editRequiredAsset':
    case 'editAssetGroup':
      return 'assets'
    case 'editShotExecutionPlan':
      return 'execution'
    case 'videoPlan':
      return 'videoPlan'
    case 'bgmScore':
      return 'bgm'
    case 'finalTimeline':
      return 'final'
  }
}

function resolveWorkspaceCanvasGroupId(node: WorkspaceCanvasFlowNode, lane: WorkspaceCanvasLayoutLane): string {
  switch (lane) {
    case 'story':
    case 'editPipeline':
    case 'editScript':
    case 'execution':
    case 'bgm':
    case 'final':
      return lane
    case 'assets':
      return node.data.editAssetDetails?.editScriptId
        ? `assets:${node.data.editAssetDetails.editScriptId}`
        : `assets:${node.data.targetType}`
    case 'videoPlan':
      return node.data.videoPlanDetails?.editScriptId
        ? `videoPlan:${node.data.videoPlanDetails.editScriptId}`
        : 'videoPlan'
  }
}

function resolveAnchorMode(
  nodeId: string,
  input: Pick<BuildWorkspaceCanvasLayoutModelInput, 'fixedAnchorPositions' | 'manualAnchorPositions'>,
): WorkspaceCanvasAnchorMode {
  if (input.manualAnchorPositions?.has(nodeId)) return 'manual'
  if (input.fixedAnchorPositions?.has(nodeId)) return 'fixed'
  return 'none'
}

function resolveBasePosition(
  node: WorkspaceCanvasFlowNode,
  input: Pick<BuildWorkspaceCanvasLayoutModelInput, 'fixedAnchorPositions' | 'manualAnchorPositions'>,
): WorkspaceCanvasLayoutPosition {
  const manualAnchorPosition = input.manualAnchorPositions?.get(node.id)
  if (manualAnchorPosition) return manualAnchorPosition
  const fixedAnchorPosition = input.fixedAnchorPositions?.get(node.id)
  if (fixedAnchorPosition) return fixedAnchorPosition
  return isWorkspaceCanvasLayoutPosition(node.data.layoutBasePosition)
    ? node.data.layoutBasePosition
    : node.position
}

function buildLayoutEdges(
  edges: readonly WorkspaceCanvasFlowEdge[] | undefined,
  nodeIds: ReadonlySet<string>,
): WorkspaceCanvasLayoutModelEdge[] {
  if (!edges || edges.length === 0) return []
  return edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
    }))
}

export function buildWorkspaceCanvasLayoutModel(
  input: BuildWorkspaceCanvasLayoutModelInput,
): WorkspaceCanvasLayoutModel {
  const nodeIds = new Set(input.nodes.map((node) => node.id))
  const nodes = input.nodes.map((node, order) => {
    const lane = resolveWorkspaceCanvasLayoutLane(node.data.kind)
    const measuredSize = input.measuredNodeSizes?.get(node.id)
    return {
      id: node.id,
      kind: node.data.kind,
      targetType: node.data.targetType,
      targetId: node.data.targetId,
      lane,
      groupId: resolveWorkspaceCanvasGroupId(node, lane),
      order,
      estimatedSize: estimatedNodeSize(node),
      measuredSize,
      basePosition: resolveBasePosition(node, input),
      anchorMode: resolveAnchorMode(node.id, input),
    }
  })

  return {
    nodes,
    layoutEdges: buildLayoutEdges(input.layoutEdges, nodeIds),
  }
}
