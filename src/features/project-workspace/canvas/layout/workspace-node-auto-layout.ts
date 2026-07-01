import type { WorkspaceCanvasFlowNode } from '../node-canvas-types'

export interface NodePosition {
  readonly x: number
  readonly y: number
}

export interface WorkspaceNodeDynamicLayoutOptions {
  readonly preservedNodePositions?: ReadonlyMap<string, NodePosition>
}

function applyNodePosition(
  node: WorkspaceCanvasFlowNode,
  position: NodePosition,
): WorkspaceCanvasFlowNode {
  return {
    ...node,
    position,
    data: {
      ...node.data,
      layoutBasePosition: position,
    },
  }
}

export function preserveWorkspaceNodePositions(
  nodes: readonly WorkspaceCanvasFlowNode[],
  preservedNodePositions: ReadonlyMap<string, NodePosition> | undefined,
): WorkspaceCanvasFlowNode[] {
  if (!preservedNodePositions || preservedNodePositions.size === 0) return [...nodes]
  return nodes.map((node) => {
    const position = preservedNodePositions.get(node.id)
    return position ? applyNodePosition(node, position) : node
  })
}
