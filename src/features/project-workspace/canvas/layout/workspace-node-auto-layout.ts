import type { WorkspaceCanvasFlowNode } from '../node-canvas-types'
import { WORKSPACE_CANVAS_BGM_SCORE_TO_FINAL_GAP_X } from '../node-presentation-profiles'

const DEFAULT_NODE_GAP = 72
const DRAG_NODE_GAP = 24
const EXECUTION_PLAN_TO_EDIT_SCRIPT_GAP = 72
const EXECUTION_PLAN_STACK_GAP = 56
const EXECUTION_PLAN_TO_CONTENT_LANE_GAP = 88
const POSITION_EPSILON = 0.5
const EXECUTION_PLAN_CONTENT_LANE_NODE_KINDS = new Set<WorkspaceCanvasFlowNode['data']['kind']>([
  'shot',
  'videoPlan',
  'bgmScore',
  'finalTimeline',
])

interface NodeRect {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly order: number
}

interface NodePosition {
  readonly x: number
  readonly y: number
}

export interface WorkspaceNodeDynamicLayoutOptions {
  readonly preservedNodePositions?: ReadonlyMap<string, NodePosition>
}

function preservedNodeIds(
  preservedNodePositions: ReadonlyMap<string, NodePosition> | undefined,
): ReadonlySet<string> | undefined {
  return preservedNodePositions && preservedNodePositions.size > 0
    ? new Set(preservedNodePositions.keys())
    : undefined
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
    if (!position) return node
    return applyNodePosition(node, position)
  })
}

function numericStyleValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nodeSize(node: WorkspaceCanvasFlowNode): { readonly width: number; readonly height: number } {
  const style = node.style
  const styleWidth = style ? numericStyleValue(style.width) : null
  const styleHeight = style ? numericStyleValue(style.height) : null
  return {
    width: styleWidth ?? node.data.width,
    height: styleHeight ?? node.data.height,
  }
}

function nodeRect(node: WorkspaceCanvasFlowNode, order: number): NodeRect {
  const size = nodeSize(node)
  return {
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    width: size.width,
    height: size.height,
    order,
  }
}

function rectsOverlap(left: NodeRect, right: NodeRect): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  )
}

function rectsOverlapWithGap(left: NodeRect, right: NodeRect, gap: number): boolean {
  return (
    left.x - gap < right.x + right.width &&
    left.x + left.width + gap > right.x &&
    left.y - gap < right.y + right.height &&
    left.y + left.height + gap > right.y
  )
}

function moveRectAwayFromAnchor(rect: NodeRect, anchor: NodeRect, gap: number): NodeRect {
  const moveLeft = anchor.x - rect.width - gap - rect.x
  const moveRight = anchor.x + anchor.width + gap - rect.x
  const moveUp = anchor.y - rect.height - gap - rect.y
  const moveDown = anchor.y + anchor.height + gap - rect.y
  const moves = [
    { axis: 'x' as const, delta: moveLeft },
    { axis: 'x' as const, delta: moveRight },
    { axis: 'y' as const, delta: moveUp },
    { axis: 'y' as const, delta: moveDown },
  ].sort((left, right) => Math.abs(left.delta) - Math.abs(right.delta))
  const move = moves[0]

  return move.axis === 'x'
    ? { ...rect, x: rect.x + move.delta }
    : { ...rect, y: rect.y + move.delta }
}

function nextAvailableY(candidate: NodeRect, placed: readonly NodeRect[], gap: number): number {
  let y = candidate.y
  let moved = true

  while (moved) {
    moved = false
    const nextCandidate = { ...candidate, y }
    for (const rect of placed) {
      if (!rectsOverlap(nextCandidate, rect)) continue
      const pushedY = rect.y + rect.height + gap
      if (pushedY > y + POSITION_EPSILON) {
        y = pushedY
        moved = true
      }
    }
  }

  return y
}

export function workspaceCanvasNodesOverlap(
  left: WorkspaceCanvasFlowNode,
  right: WorkspaceCanvasFlowNode,
): boolean {
  return rectsOverlap(nodeRect(left, 0), nodeRect(right, 1))
}

export function repairWorkspaceNodeOverlaps(
  nodes: readonly WorkspaceCanvasFlowNode[],
  options?: {
    readonly gap?: number
    readonly preservedNodeIds?: ReadonlySet<string>
  },
): WorkspaceCanvasFlowNode[] {
  const gap = options?.gap ?? DEFAULT_NODE_GAP
  const preservedNodeIds = options?.preservedNodeIds ?? new Set<string>()
  const sortedRects = nodes
    .map(nodeRect)
    .sort((left, right) => {
      if (left.y !== right.y) return left.y - right.y
      if (left.x !== right.x) return left.x - right.x
      return left.order - right.order
    })

  const fixedRects = sortedRects.filter((rect) => preservedNodeIds.has(rect.id))
  const movableRects = sortedRects.filter((rect) => !preservedNodeIds.has(rect.id))
  const placed: NodeRect[] = [...fixedRects]
  const repairedYById = new Map<string, number>()

  fixedRects.forEach((rect) => repairedYById.set(rect.id, rect.y))

  for (const rect of movableRects) {
    const y = nextAvailableY(rect, placed, gap)
    const repaired = { ...rect, y }
    placed.push(repaired)
    repairedYById.set(rect.id, y)
  }

  return nodes.map((node) => {
    const y = repairedYById.get(node.id)
    if (y === undefined || Math.abs(y - node.position.y) <= POSITION_EPSILON) return node
    return {
      ...node,
      position: {
        ...node.position,
        y,
      },
    }
  })
}

export function alignExecutionPlanNodesToMeasuredEditScript(
  nodes: readonly WorkspaceCanvasFlowNode[],
  options?: {
    readonly preservedNodeIds?: ReadonlySet<string>
  },
): WorkspaceCanvasFlowNode[] {
  const editScriptNode = nodes.find((node) => node.data.kind === 'editScript')
  if (!editScriptNode) return [...nodes]

  const executionNodes = nodes.filter((node) => node.data.kind === 'editShotExecutionPlan')
  if (executionNodes.length === 0) return [...nodes]

  const editScriptSize = nodeSize(editScriptNode)
  const editScriptCenterY = editScriptNode.position.y + editScriptSize.height / 2
  const executionNodeRects = executionNodes.map((node, index) => ({
    id: node.id,
    height: nodeSize(node).height,
    order: index,
  }))
  const totalExecutionHeight = executionNodeRects.reduce((total, rect) => total + rect.height, 0)
    + Math.max(0, executionNodeRects.length - 1) * EXECUTION_PLAN_STACK_GAP
  let nextY = editScriptCenterY - totalExecutionHeight / 2
  const nextPositionById = new Map<string, { readonly x: number; readonly y: number }>()

  for (const rect of executionNodeRects) {
    nextPositionById.set(rect.id, {
      x: editScriptNode.position.x + editScriptSize.width + EXECUTION_PLAN_TO_EDIT_SCRIPT_GAP,
      y: nextY,
    })
    nextY += rect.height + EXECUTION_PLAN_STACK_GAP
  }

  return nodes.map((node) => {
    const position = nextPositionById.get(node.id)
    if (!position) return node
    if (options?.preservedNodeIds?.has(node.id)) return node
    if (
      Math.abs(position.x - node.position.x) <= POSITION_EPSILON &&
      Math.abs(position.y - node.position.y) <= POSITION_EPSILON
    ) {
      return node
    }
    return {
      ...node,
      position,
    }
  })
}

export function avoidExpandedExecutionPlanLaneOverlaps(
  nodes: readonly WorkspaceCanvasFlowNode[],
  options?: {
    readonly gap?: number
  },
): WorkspaceCanvasFlowNode[] {
  const expandedExecutionRects = nodes
    .filter((node) => node.data.kind === 'editShotExecutionPlan' && node.data.expanded === true)
    .map(nodeRect)

  if (expandedExecutionRects.length === 0) return [...nodes]

  const gap = options?.gap ?? EXECUTION_PLAN_TO_CONTENT_LANE_GAP
  const leftAnchorX = Math.min(...expandedExecutionRects.map((rect) => rect.x))
  const requiredContentLaneX = Math.max(...expandedExecutionRects.map((rect) => rect.x + rect.width + gap))
  const contentLaneRects = nodes
    .map(nodeRect)
    .filter((rect) => {
      const node = nodes[rect.order]
      return Boolean(
        node
        && EXECUTION_PLAN_CONTENT_LANE_NODE_KINDS.has(node.data.kind)
        && rect.x > leftAnchorX,
      )
    })

  if (contentLaneRects.length === 0) return [...nodes]

  const currentContentLaneX = Math.min(...contentLaneRects.map((rect) => rect.x))
  const deltaX = requiredContentLaneX - currentContentLaneX
  if (deltaX <= POSITION_EPSILON) return [...nodes]

  const contentLaneNodeIds = new Set(contentLaneRects.map((rect) => rect.id))
  return nodes.map((node) => {
    if (!contentLaneNodeIds.has(node.id)) return node
    return {
      ...node,
      position: {
        ...node.position,
        x: node.position.x + deltaX,
      },
    }
  })
}

export function alignFinalTimelineNodesToBgmScore(
  nodes: readonly WorkspaceCanvasFlowNode[],
  options?: {
    readonly gap?: number
    readonly preservedNodeIds?: ReadonlySet<string>
  },
): WorkspaceCanvasFlowNode[] {
  const bgmScoreNodes = nodes.filter((node) => node.data.kind === 'bgmScore')
  const finalTimelineNodes = nodes.filter((node) => node.data.kind === 'finalTimeline')

  if (bgmScoreNodes.length === 0 || finalTimelineNodes.length === 0) return [...nodes]

  const gap = options?.gap ?? WORKSPACE_CANVAS_BGM_SCORE_TO_FINAL_GAP_X
  const bgmRects = bgmScoreNodes.map((node, index) => nodeRect(node, index))
  const finalPositionById = new Map<string, NodePosition>()

  finalTimelineNodes.forEach((finalNode) => {
    if (options?.preservedNodeIds?.has(finalNode.id)) return

    const finalRect = nodeRect(finalNode, 0)
    const nearestBgmRect = bgmRects
      .map((bgmRect) => ({
        rect: bgmRect,
        distance: Math.abs((finalRect.y + finalRect.height / 2) - (bgmRect.y + bgmRect.height / 2)),
      }))
      .sort((left, right) => left.distance - right.distance)[0]?.rect

    if (!nearestBgmRect) return

    const requiredX = nearestBgmRect.x + nearestBgmRect.width + gap
    const overlapsBgmVertically = (
      finalRect.y < nearestBgmRect.y + nearestBgmRect.height &&
      finalRect.y + finalRect.height > nearestBgmRect.y
    )
    const shouldMoveX = finalRect.x < requiredX - POSITION_EPSILON
    if (!shouldMoveX && !overlapsBgmVertically) return

    finalPositionById.set(finalNode.id, {
      x: shouldMoveX ? requiredX : finalRect.x,
      y: shouldMoveX || overlapsBgmVertically ? nearestBgmRect.y : finalRect.y,
    })
  })

  if (finalPositionById.size === 0) return [...nodes]

  return nodes.map((node) => {
    const position = finalPositionById.get(node.id)
    return position ? { ...node, position } : node
  })
}

export function repairWorkspaceNodeOverlapsNearMovedNodes(
  nodes: readonly WorkspaceCanvasFlowNode[],
  movedNodeIds: ReadonlySet<string>,
  options?: {
    readonly gap?: number
  },
): WorkspaceCanvasFlowNode[] {
  if (movedNodeIds.size === 0) return [...nodes]

  const gap = options?.gap ?? DRAG_NODE_GAP
  const rectById = new Map(nodes.map((node, index) => {
    const rect = nodeRect(node, index)
    return [node.id, rect]
  }))
  const movableIds = new Set(nodes.map((node) => node.id).filter((id) => !movedNodeIds.has(id)))
  const queue = [...movedNodeIds]
  const queuedIds = new Set(queue)

  while (queue.length > 0) {
    const anchorId = queue.shift()
    if (!anchorId) continue
    queuedIds.delete(anchorId)
    const anchor = rectById.get(anchorId)
    if (!anchor) continue

    for (const id of movableIds) {
      if (id === anchorId) continue
      const rect = rectById.get(id)
      if (!rect || !rectsOverlapWithGap(anchor, rect, gap)) continue
      const repaired = moveRectAwayFromAnchor(rect, anchor, gap)
      rectById.set(id, repaired)
      if (!queuedIds.has(id)) {
        queue.push(id)
        queuedIds.add(id)
      }
    }
  }

  return nodes.map((node) => {
    const repaired = rectById.get(node.id)
    if (!repaired) return node
    if (
      Math.abs(repaired.x - node.position.x) <= POSITION_EPSILON &&
      Math.abs(repaired.y - node.position.y) <= POSITION_EPSILON
    ) {
      return node
    }
    return {
      ...node,
      position: {
        x: repaired.x,
        y: repaired.y,
      },
    }
  })
}

export function applyWorkspaceNodeDynamicLayout(
  nodes: readonly WorkspaceCanvasFlowNode[],
  options?: WorkspaceNodeDynamicLayoutOptions,
): WorkspaceCanvasFlowNode[] {
  const fixedNodeIds = preservedNodeIds(options?.preservedNodePositions)
  const laneAdjustedNodes = avoidExpandedExecutionPlanLaneOverlaps(nodes)
  const finalTimelineAdjustedNodes = alignFinalTimelineNodesToBgmScore(laneAdjustedNodes, {
    preservedNodeIds: fixedNodeIds,
  })
  return repairWorkspaceNodeOverlaps(finalTimelineAdjustedNodes, {
    preservedNodeIds: fixedNodeIds,
  })
}
