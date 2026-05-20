import { describe, expect, it } from 'vitest'
import type { WorkspaceCanvasFlowNode } from '@/features/project-workspace/canvas/node-canvas-types'
import {
  applyWorkspaceNodeDynamicLayout,
  alignSpaceConsistencyNodesToMeasuredEditScript,
  alignFinalTimelineNodesToBgmScore,
  avoidExpandedSpaceConsistencyLaneOverlaps,
  preserveWorkspaceNodePositions,
  repairWorkspaceNodeOverlaps,
  repairWorkspaceNodeOverlapsNearMovedNodes,
  workspaceCanvasNodesOverlap,
} from '@/features/project-workspace/canvas/layout/workspace-node-auto-layout'

type TestNodeKind = 'shot' | 'editScript' | 'spaceConsistency' | 'videoPlan' | 'bgmScore' | 'finalTimeline'

function createNode(input: {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width?: number
  readonly height?: number
  readonly kind?: TestNodeKind
  readonly expanded?: boolean
}): WorkspaceCanvasFlowNode {
  const kind = input.kind ?? 'shot'
  const width = input.width ?? 100
  const height = input.height ?? 100
  return {
    id: input.id,
    type: 'workspaceNode',
    position: { x: input.x, y: input.y },
    style: { width, height },
    data: {
      kind,
      layoutNodeType: kind,
      targetType: 'panel',
      targetId: input.id,
      title: input.id,
      eyebrow: 'shot',
      body: 'body',
      meta: 'meta',
      statusLabel: 'ready',
      width,
      height,
      expanded: input.expanded,
    },
  }
}

describe('workspace node auto layout', () => {
  it('keeps the dragged node fixed and only moves overlapping neighbors', () => {
    const dragged = createNode({ id: 'dragged', x: 100, y: 100 })
    const neighbor = createNode({ id: 'neighbor', x: 150, y: 100 })
    const far = createNode({ id: 'far', x: 600, y: 100 })

    const repaired = repairWorkspaceNodeOverlapsNearMovedNodes(
      [dragged, neighbor, far],
      new Set(['dragged']),
      { gap: 24 },
    )

    const repairedDragged = repaired.find((node) => node.id === 'dragged')
    const repairedNeighbor = repaired.find((node) => node.id === 'neighbor')
    const repairedFar = repaired.find((node) => node.id === 'far')

    expect(repairedDragged?.position).toEqual({ x: 100, y: 100 })
    expect(repairedNeighbor?.position).toEqual({ x: 224, y: 100 })
    expect(repairedFar?.position).toEqual({ x: 600, y: 100 })
    expect(repairedDragged && repairedNeighbor ? workspaceCanvasNodesOverlap(repairedDragged, repairedNeighbor) : true).toBe(false)
  })

  it('repairs even a one-pixel edge overlap', () => {
    const dragged = createNode({ id: 'dragged', x: 100, y: 100 })
    const neighbor = createNode({ id: 'neighbor', x: 199, y: 100 })

    expect(workspaceCanvasNodesOverlap(dragged, neighbor)).toBe(true)

    const repaired = repairWorkspaceNodeOverlapsNearMovedNodes(
      [dragged, neighbor],
      new Set(['dragged']),
      { gap: 24 },
    )

    const repairedDragged = repaired.find((node) => node.id === 'dragged')
    const repairedNeighbor = repaired.find((node) => node.id === 'neighbor')

    expect(repairedDragged?.position).toEqual({ x: 100, y: 100 })
    expect(repairedNeighbor?.position).toEqual({ x: 224, y: 100 })
    expect(repairedDragged && repairedNeighbor ? workspaceCanvasNodesOverlap(repairedDragged, repairedNeighbor) : true).toBe(false)
  })

  it('pushes only the local collision chain when a neighbor lands on another card', () => {
    const dragged = createNode({ id: 'dragged', x: 100, y: 100 })
    const firstNeighbor = createNode({ id: 'first-neighbor', x: 150, y: 100 })
    const secondNeighbor = createNode({ id: 'second-neighbor', x: 260, y: 100 })
    const far = createNode({ id: 'far', x: 700, y: 100 })

    const repaired = repairWorkspaceNodeOverlapsNearMovedNodes(
      [dragged, firstNeighbor, secondNeighbor, far],
      new Set(['dragged']),
      { gap: 24 },
    )

    const repairedDragged = repaired.find((node) => node.id === 'dragged')
    const repairedFirst = repaired.find((node) => node.id === 'first-neighbor')
    const repairedSecond = repaired.find((node) => node.id === 'second-neighbor')
    const repairedFar = repaired.find((node) => node.id === 'far')

    expect(repairedDragged?.position).toEqual({ x: 100, y: 100 })
    expect(repairedFirst?.position).toEqual({ x: 224, y: 100 })
    expect(repairedSecond?.position).toEqual({ x: 348, y: 100 })
    expect(repairedFar?.position).toEqual({ x: 700, y: 100 })
    expect(repairedFirst && repairedSecond ? workspaceCanvasNodesOverlap(repairedFirst, repairedSecond) : true).toBe(false)
  })

  it('centers the space consistency node against the measured edit script height', () => {
    const editScript = createNode({
      id: 'edit-script:long',
      kind: 'editScript',
      x: 320,
      y: 600,
      width: 720,
      height: 1440,
    })
    const spaceConsistency = createNode({
      id: 'space-consistency:storyboard',
      kind: 'spaceConsistency',
      x: 1200,
      y: 1800,
      width: 640,
      height: 520,
    })
    const shot = createNode({ id: 'shot:1', kind: 'shot', x: 2000, y: 600 })

    const aligned = alignSpaceConsistencyNodesToMeasuredEditScript([editScript, spaceConsistency, shot])
    const alignedSpaceConsistency = aligned.find((node) => node.id === spaceConsistency.id)

    expect(alignedSpaceConsistency?.position.x).toBe(1112)
    expect(alignedSpaceConsistency?.position.y).toBe(1060)
    expect(shot.position).toEqual({ x: 2000, y: 600 })
  })

  it('preserves a measured space consistency node position while its own height changes', () => {
    const editScript = createNode({
      id: 'edit-script:long',
      kind: 'editScript',
      x: 320,
      y: 600,
      width: 720,
      height: 1440,
    })
    const spaceConsistency = createNode({
      id: 'space-consistency:storyboard',
      kind: 'spaceConsistency',
      x: 1200,
      y: 1800,
      width: 760,
      height: 1180,
      expanded: true,
    })
    const shot = createNode({ id: 'shot:1', kind: 'shot', x: 2200, y: 600 })

    const aligned = alignSpaceConsistencyNodesToMeasuredEditScript(
      [editScript, spaceConsistency, shot],
      { preservedNodeIds: new Set([spaceConsistency.id]) },
    )
    const alignedSpaceConsistency = aligned.find((node) => node.id === spaceConsistency.id)

    expect(alignedSpaceConsistency?.position).toEqual({ x: 1200, y: 1800 })
    expect(shot.position).toEqual({ x: 2200, y: 600 })
  })

  it('keeps an expanded space consistency anchor fixed during global overlap repair', () => {
    const earlierNeighbor = createNode({
      id: 'neighbor:earlier',
      kind: 'shot',
      x: 100,
      y: 80,
      width: 420,
      height: 560,
    })
    const spaceConsistency = createNode({
      id: 'space-consistency:expanded',
      kind: 'spaceConsistency',
      x: 100,
      y: 120,
      width: 760,
      height: 820,
      expanded: true,
    })
    const laterNeighbor = createNode({
      id: 'neighbor:later',
      kind: 'shot',
      x: 100,
      y: 160,
      width: 420,
      height: 560,
    })

    const repaired = repairWorkspaceNodeOverlaps(
      [earlierNeighbor, spaceConsistency, laterNeighbor],
      { preservedNodeIds: new Set([spaceConsistency.id]) },
    )
    const repairedSpaceConsistency = repaired.find((node) => node.id === spaceConsistency.id)
    const repairedLaterNeighbor = repaired.find((node) => node.id === laterNeighbor.id)

    expect(repairedSpaceConsistency?.position).toEqual({ x: 100, y: 120 })
    expect(repairedLaterNeighbor?.position.y).toBeGreaterThan(spaceConsistency.position.y + spaceConsistency.data.height)
  })

  it('treats preserved anchors as fixed obstacles instead of leaving earlier nodes overlapped', () => {
    const earlierNeighbor = createNode({
      id: 'neighbor:earlier',
      kind: 'shot',
      x: 100,
      y: 80,
      width: 420,
      height: 560,
    })
    const anchor = createNode({
      id: 'video-plan:expanded',
      kind: 'videoPlan',
      x: 100,
      y: 120,
      width: 420,
      height: 760,
      expanded: true,
    })
    const laterNeighbor = createNode({
      id: 'neighbor:later',
      kind: 'shot',
      x: 100,
      y: 160,
      width: 420,
      height: 560,
    })

    const repaired = repairWorkspaceNodeOverlaps(
      [earlierNeighbor, anchor, laterNeighbor],
      { preservedNodeIds: new Set([anchor.id]) },
    )
    const repairedAnchor = repaired.find((node) => node.id === anchor.id)
    const repairedEarlier = repaired.find((node) => node.id === earlierNeighbor.id)
    const repairedLater = repaired.find((node) => node.id === laterNeighbor.id)

    expect(repairedAnchor?.position).toEqual(anchor.position)
    expect(repairedEarlier && repairedAnchor ? workspaceCanvasNodesOverlap(repairedEarlier, repairedAnchor) : true).toBe(false)
    expect(repairedLater && repairedAnchor ? workspaceCanvasNodesOverlap(repairedLater, repairedAnchor) : true).toBe(false)
  })

  it('preserves the current anchor position over a stale layout base position', () => {
    const staleBase = { x: 100, y: 1200 }
    const actualAnchor = { x: 100, y: 480 }
    const baseSpaceConsistency = createNode({
      id: 'space-consistency:expanded',
      kind: 'spaceConsistency',
      x: staleBase.x,
      y: staleBase.y,
      width: 760,
      height: 820,
      expanded: true,
    })
    const spaceConsistency: WorkspaceCanvasFlowNode = {
      ...baseSpaceConsistency,
      data: {
        ...baseSpaceConsistency.data,
        layoutBasePosition: staleBase,
      },
    }

    const preserved = preserveWorkspaceNodePositions(
      [spaceConsistency],
      new Map([[spaceConsistency.id, actualAnchor]]),
    )

    expect(preserved[0]?.position).toEqual(actualAnchor)
    expect(preserved[0]?.data.layoutBasePosition).toEqual(actualAnchor)
  })

  it('moves the right content lane as one group when space consistency expands into it', () => {
    const spaceConsistency = createNode({
      id: 'space-consistency:expanded',
      kind: 'spaceConsistency',
      x: 100,
      y: 80,
      width: 760,
      height: 820,
      expanded: true,
    })
    const videoPlan = createNode({
      id: 'video-plan:1',
      kind: 'videoPlan',
      x: 620,
      y: 120,
      width: 420,
      height: 560,
    })
    const nextVideoPlan = createNode({
      id: 'video-plan:2',
      kind: 'videoPlan',
      x: 1084,
      y: 120,
      width: 420,
      height: 560,
    })
    const bgmScore = createNode({
      id: 'bgm-score:episode',
      kind: 'bgmScore',
      x: 620,
      y: 720,
      width: 420,
      height: 320,
    })

    const repaired = avoidExpandedSpaceConsistencyLaneOverlaps([
      spaceConsistency,
      videoPlan,
      nextVideoPlan,
      bgmScore,
    ])
    const repairedVideoPlan = repaired.find((node) => node.id === videoPlan.id)
    const repairedNextVideoPlan = repaired.find((node) => node.id === nextVideoPlan.id)
    const repairedBgmScore = repaired.find((node) => node.id === bgmScore.id)

    expect(repairedVideoPlan?.position.x).toBe(948)
    expect(repairedNextVideoPlan?.position.x).toBe(1412)
    expect(repairedBgmScore?.position.x).toBe(948)
    expect(repairedVideoPlan && workspaceCanvasNodesOverlap(spaceConsistency, repairedVideoPlan)).toBe(false)
  })

  it('keeps the expanded node position fixed through the composed dynamic layout pass', () => {
    const expandedVideoPlan = createNode({
      id: 'video-plan:expanded',
      kind: 'videoPlan',
      x: 620,
      y: 120,
      width: 420,
      height: 760,
      expanded: true,
    })
    const neighbor = createNode({
      id: 'neighbor:overlap',
      kind: 'shot',
      x: 620,
      y: 160,
      width: 420,
      height: 560,
    })

    const repaired = applyWorkspaceNodeDynamicLayout(
      [expandedVideoPlan, neighbor],
      { preservedNodePositions: new Map([[expandedVideoPlan.id, expandedVideoPlan.position]]) },
    )
    const repairedExpanded = repaired.find((node) => node.id === expandedVideoPlan.id)
    const repairedNeighbor = repaired.find((node) => node.id === neighbor.id)

    expect(repairedExpanded?.position).toEqual(expandedVideoPlan.position)
    expect(repairedExpanded && repairedNeighbor ? workspaceCanvasNodesOverlap(repairedExpanded, repairedNeighbor) : true).toBe(false)
  })

  it('does not move the content lane when space consistency is collapsed', () => {
    const spaceConsistency = createNode({
      id: 'space-consistency:collapsed',
      kind: 'spaceConsistency',
      x: 100,
      y: 80,
      width: 460,
      height: 620,
      expanded: false,
    })
    const videoPlan = createNode({
      id: 'video-plan:1',
      kind: 'videoPlan',
      x: 620,
      y: 120,
      width: 420,
      height: 560,
    })

    const repaired = avoidExpandedSpaceConsistencyLaneOverlaps([spaceConsistency, videoPlan])
    const repairedVideoPlan = repaired.find((node) => node.id === videoPlan.id)

    expect(repairedVideoPlan?.position).toEqual({ x: 620, y: 120 })
  })

  it('keeps the final timeline to the right of the expanded BGM score using the current BGM size', () => {
    const bgmScore = createNode({
      id: 'bgm-score:episode',
      kind: 'bgmScore',
      x: 620,
      y: 720,
      width: 1040,
      height: 940,
      expanded: true,
    })
    const finalTimeline = createNode({
      id: 'final:episode',
      kind: 'finalTimeline',
      x: 620,
      y: 1040,
      width: 340,
      height: 280,
    })

    const repaired = alignFinalTimelineNodesToBgmScore([bgmScore, finalTimeline])
    const repairedFinal = repaired.find((node) => node.id === finalTimeline.id)

    expect(repairedFinal?.position).toEqual({ x: 1748, y: 720 })
    expect(repairedFinal && workspaceCanvasNodesOverlap(bgmScore, repairedFinal)).toBe(false)
  })
})
