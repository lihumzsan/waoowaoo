import type { WorkspaceCanvasFlowNode } from '../node-canvas-types'
import {
  preserveWorkspaceNodePositions,
  type WorkspaceNodeDynamicLayoutOptions,
} from './workspace-node-auto-layout'
import {
  buildWorkspaceCanvasLayoutModel,
  isWorkspaceCanvasLayoutPosition,
  type WorkspaceCanvasLayoutModel,
} from './workspace-layout-model'

export interface ComposeWorkspaceCanvasLegacyLayoutInput extends WorkspaceNodeDynamicLayoutOptions {
  readonly nodes: readonly WorkspaceCanvasFlowNode[]
  readonly model: WorkspaceCanvasLayoutModel
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

export function composeWorkspaceCanvasLegacyLayout(
  input: ComposeWorkspaceCanvasLegacyLayoutInput,
): WorkspaceCanvasFlowNode[] {
  assertModelMatchesNodes(input.nodes, input.model)
  const normalizedNodes = normalizeNodesToLayoutBasePositions(input.nodes)
  return preserveWorkspaceNodePositions(normalizedNodes, input.preservedNodePositions)
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
