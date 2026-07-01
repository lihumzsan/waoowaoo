import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceCanvasLegacyLayoutModel,
  composeWorkspaceCanvasLegacyLayout,
  repairWorkspaceCanvasDraggedLayout,
} from '@/features/project-workspace/canvas/layout/workspace-layout-composer'
import {
  repairWorkspaceNodeCollisions,
  WORKSPACE_CANVAS_DEFAULT_NODE_GAP,
  WORKSPACE_CANVAS_DRAG_NODE_GAP,
  WorkspaceCanvasLayoutFailure,
} from '@/features/project-workspace/canvas/layout/workspace-node-auto-layout'
import type { WorkspaceCanvasFlowNode } from '@/features/project-workspace/canvas/node-canvas-types'

interface TestNodeInput {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width?: number
  readonly height?: number
  readonly baseX?: number
  readonly baseY?: number
}

function node(input: TestNodeInput): WorkspaceCanvasFlowNode {
  const width = input.width ?? 320
  const height = input.height ?? 240
  const basePosition = {
    x: input.baseX ?? input.x,
    y: input.baseY ?? input.y,
  }

  return {
    id: input.id,
    type: 'workspaceNode',
    position: { x: input.x, y: input.y },
    style: { width, height },
    data: {
      kind: 'shot',
      layoutNodeType: 'shot',
      targetType: 'panel',
      targetId: input.id,
      title: input.id,
      eyebrow: '',
      body: '',
      meta: '',
      statusLabel: '',
      width: 320,
      height: 240,
      layoutBasePosition: basePosition,
    },
  }
}

function findNode(nodes: readonly WorkspaceCanvasFlowNode[], id: string): WorkspaceCanvasFlowNode {
  const found = nodes.find((item) => item.id === id)
  if (!found) throw new Error(`Missing test node ${id}.`)
  return found
}

describe('workspace canvas collision layout', () => {
  it('treats saved positions as base coordinates while expanded nodes push neighbors away', () => {
    const nodes = [
      node({ id: 'shot:expanded-panel', x: 0, y: 0, width: 720, height: 560 }),
      node({ id: 'shot:neighbor-panel', x: 700, y: 0 }),
    ]

    const layout = composeWorkspaceCanvasLegacyLayout({
      nodes,
      model: buildWorkspaceCanvasLegacyLayoutModel(nodes),
    })

    expect(findNode(layout, 'shot:expanded-panel').position).toEqual({ x: 0, y: 0 })
    expect(findNode(layout, 'shot:neighbor-panel').position.x).toBeGreaterThanOrEqual(720 + WORKSPACE_CANVAS_DEFAULT_NODE_GAP)
    expect(findNode(layout, 'shot:neighbor-panel').data.layoutBasePosition).toEqual({ x: 700, y: 0 })
  })

  it('keeps explicit expansion anchors fixed while repairing horizontal edge overlap with gap', () => {
    const nodes = [
      node({ id: 'shot:anchor-panel', x: 0, y: 0 }),
      node({ id: 'shot:edge-panel', x: 300, y: 12 }),
    ]
    const preservedNodePositions = new Map([
      ['shot:anchor-panel', { x: 0, y: 0 }],
    ])

    const layout = composeWorkspaceCanvasLegacyLayout({
      nodes,
      model: buildWorkspaceCanvasLegacyLayoutModel(nodes, { preservedNodePositions }),
      preservedNodePositions,
      collisionAnchorNodeIds: new Set(['shot:anchor-panel']),
    })

    expect(findNode(layout, 'shot:anchor-panel').position).toEqual({ x: 0, y: 0 })
    expect(findNode(layout, 'shot:edge-panel').position.x).toBe(320 + WORKSPACE_CANVAS_DEFAULT_NODE_GAP)
  })

  it('returns automatically displaced nodes to their base position after the expansion anchor is removed', () => {
    const expandedNodes = [
      node({ id: 'shot:expanded-panel', x: 0, y: 0, width: 720, height: 560 }),
      node({ id: 'shot:neighbor-panel', x: 700, y: 0 }),
    ]
    const anchorPositions = new Map([
      ['shot:expanded-panel', { x: 0, y: 0 }],
    ])
    const expandedLayout = composeWorkspaceCanvasLegacyLayout({
      nodes: expandedNodes,
      model: buildWorkspaceCanvasLegacyLayoutModel(expandedNodes, { preservedNodePositions: anchorPositions }),
      preservedNodePositions: anchorPositions,
      collisionAnchorNodeIds: new Set(['shot:expanded-panel']),
    })

    expect(findNode(expandedLayout, 'shot:neighbor-panel').position.x).toBe(720 + WORKSPACE_CANVAS_DEFAULT_NODE_GAP)

    const collapsedNodes = expandedLayout.map((item) => (
      item.id === 'shot:expanded-panel'
        ? {
            ...item,
            style: { ...item.style, width: 320, height: 240 },
          }
        : item
    ))
    const collapsedLayout = composeWorkspaceCanvasLegacyLayout({
      nodes: collapsedNodes,
      model: buildWorkspaceCanvasLegacyLayoutModel(collapsedNodes),
    })

    expect(findNode(collapsedLayout, 'shot:neighbor-panel').position).toEqual({ x: 700, y: 0 })
  })

  it('keeps a node dragged during expansion at its repaired drag base after collapse', () => {
    const expandedNodes = [
      node({ id: 'shot:expanded-panel', x: 0, y: 0, width: 720, height: 560 }),
      node({ id: 'shot:neighbor-panel', x: 980, y: 0, baseX: 700, baseY: 0 }),
    ]
    const draggedLayout = repairWorkspaceCanvasDraggedLayout({
      nodes: expandedNodes,
      movedNodeIds: new Set(['shot:neighbor-panel']),
    })
    const collapsedNodes = draggedLayout.map((item) => (
      item.id === 'shot:expanded-panel'
        ? {
            ...item,
            style: { ...item.style, width: 320, height: 240 },
          }
        : item
    ))

    const collapsedLayout = composeWorkspaceCanvasLegacyLayout({
      nodes: collapsedNodes,
      model: buildWorkspaceCanvasLegacyLayoutModel(collapsedNodes),
    })

    expect(findNode(collapsedLayout, 'shot:neighbor-panel').position).toEqual({ x: 980, y: 0 })
    expect(findNode(collapsedLayout, 'shot:neighbor-panel').data.layoutBasePosition).toEqual({ x: 980, y: 0 })
  })

  it('captures dragged and collision-repaired nodes as base without rewriting unaffected transient nodes', () => {
    const nodes = [
      node({ id: 'shot:dragged-panel', x: 0, y: 0 }),
      node({ id: 'shot:repaired-panel', x: 300, y: 0 }),
      node({ id: 'shot:transient-panel', x: 1200, y: 120, baseX: 1000, baseY: 80 }),
    ]

    const layout = repairWorkspaceCanvasDraggedLayout({
      nodes,
      movedNodeIds: new Set(['shot:dragged-panel']),
    })

    expect(findNode(layout, 'shot:dragged-panel').data.layoutBasePosition).toEqual({ x: 0, y: 0 })
    expect(findNode(layout, 'shot:repaired-panel').position.x).toBe(320 + WORKSPACE_CANVAS_DRAG_NODE_GAP)
    expect(findNode(layout, 'shot:repaired-panel').data.layoutBasePosition).toEqual({ x: 320 + WORKSPACE_CANVAS_DRAG_NODE_GAP, y: 0 })
    expect(findNode(layout, 'shot:transient-panel').data.layoutBasePosition).toEqual({ x: 1000, y: 80 })
  })

  it('fails explicitly when fixed overlapping nodes leave no legal repair move', () => {
    const nodes = [
      node({ id: 'shot:fixed-a', x: 0, y: 0 }),
      node({ id: 'shot:fixed-b', x: 0, y: 0 }),
    ]

    expect(() => repairWorkspaceNodeCollisions(nodes, {
      fixedNodeIds: new Set(['shot:fixed-a', 'shot:fixed-b']),
      collisionAnchorNodeIds: new Set(['shot:fixed-a', 'shot:fixed-b']),
    })).toThrow(WorkspaceCanvasLayoutFailure)
  })
})
