import type { WorkspaceCanvasFlowNode } from '../node-canvas-types'
import {
  WORKSPACE_CANVAS_EDIT_ASSET_GRID_COLUMNS,
  WORKSPACE_CANVAS_EDIT_ASSET_GRID_GAP_Y,
  WORKSPACE_CANVAS_EDIT_SCRIPT_TO_ASSET_GAP_Y,
} from '../node-presentation-profiles'
import {
  applyWorkspaceNodeDynamicLayout,
  preserveWorkspaceNodePositions,
  repairWorkspaceNodeCollisions,
  WORKSPACE_CANVAS_DRAG_NODE_GAP,
  type WorkspaceNodeDynamicLayoutOptions,
} from './workspace-node-auto-layout'
import {
  buildWorkspaceCanvasLayoutModel,
  isWorkspaceCanvasLayoutPosition,
  type WorkspaceCanvasLayoutModel,
  type WorkspaceCanvasLayoutPosition,
} from './workspace-layout-model'

export interface ComposeWorkspaceCanvasLegacyLayoutInput extends WorkspaceNodeDynamicLayoutOptions {
  readonly nodes: readonly WorkspaceCanvasFlowNode[]
  readonly model: WorkspaceCanvasLayoutModel
}

export interface RepairWorkspaceCanvasDraggedLayoutInput {
  readonly nodes: readonly WorkspaceCanvasFlowNode[]
  readonly movedNodeIds: ReadonlySet<string>
}

export interface CaptureLayoutBasePositionsInput {
  readonly nodes: readonly WorkspaceCanvasFlowNode[]
  readonly nodeIds?: ReadonlySet<string>
}

function isWorkspaceCanvasNodeArray(
  input: readonly WorkspaceCanvasFlowNode[] | CaptureLayoutBasePositionsInput,
): input is readonly WorkspaceCanvasFlowNode[] {
  return Array.isArray(input)
}

function assertModelMatchesNodes(
  nodes: readonly WorkspaceCanvasFlowNode[],
  model: WorkspaceCanvasLayoutModel,
): void {
  if (nodes.length !== model.nodes.length) {
    throw new Error('Workspace canvas layout model does not match node count.')
  }

  const modelNodeIds = new Set(model.nodes.map((node) => node.id))
  for (const node of nodes) {
    if (!modelNodeIds.has(node.id)) {
      throw new Error(`Workspace canvas layout model is missing node ${node.id}.`)
    }
  }
}

export function normalizeNodesToLayoutBasePositions(
  nodes: readonly WorkspaceCanvasFlowNode[],
): WorkspaceCanvasFlowNode[] {
  return nodes.map((node) => {
    const basePosition = isWorkspaceCanvasLayoutPosition(node.data.layoutBasePosition)
      ? node.data.layoutBasePosition
      : node.position
    return {
      ...node,
      position: basePosition,
      data: {
        ...node.data,
        layoutBasePosition: basePosition,
      },
    }
  })
}

export function captureLayoutBasePositions(
  inputNodes: readonly WorkspaceCanvasFlowNode[] | CaptureLayoutBasePositionsInput,
): WorkspaceCanvasFlowNode[] {
  const nodes = isWorkspaceCanvasNodeArray(inputNodes) ? inputNodes : inputNodes.nodes
  const nodeIds = isWorkspaceCanvasNodeArray(inputNodes) ? undefined : inputNodes.nodeIds
  return nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      layoutBasePosition: nodeIds && !nodeIds.has(node.id)
        ? node.data.layoutBasePosition
        : node.position,
    },
  }))
}

export function preservedNodeIdSet(
  preservedNodePositions: ReadonlyMap<string, WorkspaceCanvasLayoutPosition> | undefined,
): ReadonlySet<string> | undefined {
  return preservedNodePositions && preservedNodePositions.size > 0
    ? new Set(preservedNodePositions.keys())
    : undefined
}

export function mergePreservedNodePositions(
  ...positionMaps: Array<ReadonlyMap<string, WorkspaceCanvasLayoutPosition> | undefined>
): ReadonlyMap<string, WorkspaceCanvasLayoutPosition> | undefined {
  const next = new Map<string, WorkspaceCanvasLayoutPosition>()
  positionMaps.forEach((positionMap) => {
    positionMap?.forEach((position, nodeId) => {
      next.set(nodeId, position)
    })
  })
  return next.size > 0 ? next : undefined
}

export function relayoutEditAssetsBelowScript(
  nodes: readonly WorkspaceCanvasFlowNode[],
): WorkspaceCanvasFlowNode[] {
  const editScriptNode = nodes.find((node) => node.data.kind === 'editScript')
  if (!editScriptNode) return [...nodes]

  // 资产合并为单张「editAssetGroup」卡后，仅需把它放到（测高后的）剪辑表正下方
  const assetGroupNode = nodes.find((node) => node.data.kind === 'editAssetGroup')
  if (assetGroupNode) {
    const y = editScriptNode.position.y + editScriptNode.data.height + WORKSPACE_CANVAS_EDIT_SCRIPT_TO_ASSET_GAP_Y
    return nodes.map((node) => (node.id === assetGroupNode.id ? { ...node, position: { x: node.position.x, y } } : node))
  }

  const assetNodes = nodes.filter((node) => node.data.kind === 'editRequiredAsset')
  if (assetNodes.length === 0) return [...nodes]

  let assetRowY = editScriptNode.position.y + editScriptNode.data.height + WORKSPACE_CANVAS_EDIT_SCRIPT_TO_ASSET_GAP_Y
  let assetRowMaxHeight = 0
  let assetIndex = 0
  const nextPositionById = new Map<string, WorkspaceCanvasLayoutPosition>()

  for (const assetNode of assetNodes) {
    const column = assetIndex % WORKSPACE_CANVAS_EDIT_ASSET_GRID_COLUMNS
    if (column === 0 && assetIndex > 0) {
      assetRowY += assetRowMaxHeight + WORKSPACE_CANVAS_EDIT_ASSET_GRID_GAP_Y
      assetRowMaxHeight = 0
    }
    assetRowMaxHeight = Math.max(assetRowMaxHeight, assetNode.data.height)
    nextPositionById.set(assetNode.id, {
      x: assetNode.position.x,
      y: assetRowY,
    })
    assetIndex += 1
  }

  return nodes.map((node) => {
    const position = nextPositionById.get(node.id)
    return position ? { ...node, position } : node
  })
}

export function composeWorkspaceCanvasLegacyLayout(
  input: ComposeWorkspaceCanvasLegacyLayoutInput,
): WorkspaceCanvasFlowNode[] {
  assertModelMatchesNodes(input.nodes, input.model)
  const normalizedNodes = normalizeNodesToLayoutBasePositions(input.nodes)
  const anchoredNodes = preserveWorkspaceNodePositions(normalizedNodes, input.preservedNodePositions)
  return applyWorkspaceNodeDynamicLayout(anchoredNodes, {
    preservedNodePositions: input.preservedNodePositions,
    collisionAnchorNodeIds: input.collisionAnchorNodeIds,
  })
}

export function buildWorkspaceCanvasLegacyLayoutModel(
  nodes: readonly WorkspaceCanvasFlowNode[],
  options?: WorkspaceNodeDynamicLayoutOptions,
): WorkspaceCanvasLayoutModel {
  return buildWorkspaceCanvasLayoutModel({
    nodes,
    fixedAnchorPositions: options?.preservedNodePositions,
  })
}

export function repairWorkspaceCanvasDraggedLayout(
  input: RepairWorkspaceCanvasDraggedLayoutInput,
): WorkspaceCanvasFlowNode[] {
  const repaired = repairWorkspaceNodeCollisions(input.nodes, {
    gap: WORKSPACE_CANVAS_DRAG_NODE_GAP,
    fixedNodeIds: input.movedNodeIds,
    collisionAnchorNodeIds: input.movedNodeIds,
  })
  const baseNodeIds = new Set([...input.movedNodeIds, ...repaired.movedNodeIds])
  return captureLayoutBasePositions({
    nodes: repaired.nodes,
    nodeIds: baseNodeIds,
  })
}
