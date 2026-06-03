import { describe, expect, it } from 'vitest'
import type { WorkspaceCanvasFlowNode } from '@/features/project-workspace/canvas/node-canvas-types'
import type { CanvasLayoutNodeType } from '@/lib/project-canvas/layout/canvas-layout-contract'
import {
  buildWorkspaceCanvasLegacyLayoutModel,
  composeWorkspaceCanvasLegacyLayout,
  repairWorkspaceCanvasDraggedLayout,
} from '@/features/project-workspace/canvas/layout/workspace-layout-composer'
import { workspaceCanvasNodesOverlap } from '@/features/project-workspace/canvas/layout/workspace-node-auto-layout'

function createNode(input: {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width?: number
  readonly height?: number
  readonly kind?: WorkspaceCanvasFlowNode['data']['kind']
  readonly expanded?: boolean
  readonly layoutBasePosition?: { readonly x: number; readonly y: number }
}): WorkspaceCanvasFlowNode {
  const kind = input.kind ?? 'shot'
  const width = input.width ?? 100
  const height = input.height ?? 100
  const layoutNodeType: CanvasLayoutNodeType = kind
  return {
    id: input.id,
    type: 'workspaceNode',
    position: { x: input.x, y: input.y },
    style: { width, height },
    data: {
      kind,
      layoutNodeType,
      targetType: 'panel',
      targetId: input.id,
      title: input.id,
      eyebrow: 'node',
      body: 'body',
      meta: 'meta',
      statusLabel: 'ready',
      width,
      height,
      expanded: input.expanded,
      layoutBasePosition: input.layoutBasePosition,
    },
  }
}

describe('workspace layout composer', () => {
  it('runs legacy avoidance through a layout model while keeping an expansion anchor fixed', () => {
    const anchor = createNode({
      id: 'space-consistency',
      kind: 'spaceConsistency',
      x: 100,
      y: 300,
      width: 760,
      height: 820,
      expanded: true,
      layoutBasePosition: { x: 100, y: 900 },
    })
    const overlappingShot = createNode({
      id: 'shot',
      kind: 'shot',
      x: 100,
      y: 320,
      width: 420,
      height: 560,
    })
    const preservedNodePositions = new Map([[anchor.id, { x: 100, y: 300 }]])

    const layouted = composeWorkspaceCanvasLegacyLayout({
      nodes: [anchor, overlappingShot],
      model: buildWorkspaceCanvasLegacyLayoutModel([anchor, overlappingShot], { preservedNodePositions }),
      preservedNodePositions,
    })
    const layoutedAnchor = layouted.find((node) => node.id === anchor.id)
    const layoutedShot = layouted.find((node) => node.id === overlappingShot.id)

    expect(layoutedAnchor?.position).toEqual({ x: 100, y: 300 })
    expect(layoutedShot && layoutedAnchor ? workspaceCanvasNodesOverlap(layoutedShot, layoutedAnchor) : true).toBe(false)
  })

  it('keeps dragged nodes as local anchors and captures repaired layout base positions', () => {
    const dragged = createNode({ id: 'dragged', x: 100, y: 100 })
    const neighbor = createNode({ id: 'neighbor', x: 150, y: 100 })

    const repaired = repairWorkspaceCanvasDraggedLayout({
      nodes: [dragged, neighbor],
      movedNodeIds: new Set(['dragged']),
    })
    const repairedDragged = repaired.find((node) => node.id === dragged.id)
    const repairedNeighbor = repaired.find((node) => node.id === neighbor.id)

    expect(repairedDragged?.position).toEqual({ x: 100, y: 100 })
    expect(repairedDragged?.data.layoutBasePosition).toEqual({ x: 100, y: 100 })
    expect(repairedNeighbor?.position).toEqual({ x: 224, y: 100 })
    expect(repairedNeighbor?.data.layoutBasePosition).toEqual({ x: 224, y: 100 })
  })

  it('fails explicitly when the layout model does not describe the nodes being composed', () => {
    const node = createNode({ id: 'node', x: 0, y: 0 })
    const staleModel = buildWorkspaceCanvasLegacyLayoutModel([createNode({ id: 'stale', x: 0, y: 0 })])

    expect(() => composeWorkspaceCanvasLegacyLayout({
      nodes: [node],
      model: staleModel,
    })).toThrow('Workspace canvas layout model is missing node node.')
  })
})
