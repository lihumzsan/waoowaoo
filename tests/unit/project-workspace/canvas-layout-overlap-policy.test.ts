import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceCanvasLegacyLayoutModel,
  captureLayoutBasePositions,
  composeWorkspaceCanvasLegacyLayout,
} from '@/features/project-workspace/canvas/layout/workspace-layout-composer'
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
      mediaLoadingContext: { styleImageUrl: null },
      layoutNodeType: 'shot',
      targetType: 'panel',
      targetId: input.id,
      title: input.id,
      eyebrow: '',
      body: '',
      meta: '',
      statusLabel: '',
      width,
      height,
      layoutBasePosition: basePosition,
    },
  }
}

function findNode(nodes: readonly WorkspaceCanvasFlowNode[], id: string): WorkspaceCanvasFlowNode {
  const found = nodes.find((item) => item.id === id)
  if (!found) throw new Error(`Missing test node ${id}.`)
  return found
}

describe('workspace canvas overlap policy', () => {
  it('allows overlapping nodes without automatic collision repair', () => {
    const nodes = [
      node({ id: 'shot:first-panel', x: 0, y: 0, width: 720, height: 560 }),
      node({ id: 'shot:second-panel', x: 120, y: 80, width: 420, height: 360 }),
    ]

    const layout = composeWorkspaceCanvasLegacyLayout({
      nodes,
      model: buildWorkspaceCanvasLegacyLayoutModel(nodes),
    })

    expect(findNode(layout, 'shot:first-panel').position).toEqual({ x: 0, y: 0 })
    expect(findNode(layout, 'shot:second-panel').position).toEqual({ x: 120, y: 80 })
  })

  it('captures only dragged nodes as new base positions', () => {
    const nodes = [
      node({ id: 'shot:dragged-panel', x: 40, y: 50, baseX: 0, baseY: 0 }),
      node({ id: 'shot:untouched-panel', x: 300, y: 200, baseX: 120, baseY: 90 }),
    ]

    const layout = captureLayoutBasePositions({
      nodes,
      nodeIds: new Set(['shot:dragged-panel']),
    })

    expect(findNode(layout, 'shot:dragged-panel').data.layoutBasePosition).toEqual({ x: 40, y: 50 })
    expect(findNode(layout, 'shot:untouched-panel').data.layoutBasePosition).toEqual({ x: 120, y: 90 })
  })

  it('keeps explicit preserved positions as base without moving other nodes', () => {
    const nodes = [
      node({ id: 'shot:preserved-panel', x: 0, y: 0 }),
      node({ id: 'shot:free-panel', x: 0, y: 0 }),
    ]
    const preservedNodePositions = new Map([
      ['shot:preserved-panel', { x: 480, y: 320 }],
    ])

    const layout = composeWorkspaceCanvasLegacyLayout({
      nodes,
      model: buildWorkspaceCanvasLegacyLayoutModel(nodes, { preservedNodePositions }),
      preservedNodePositions,
    })

    expect(findNode(layout, 'shot:preserved-panel').position).toEqual({ x: 480, y: 320 })
    expect(findNode(layout, 'shot:free-panel').position).toEqual({ x: 0, y: 0 })
  })
})
