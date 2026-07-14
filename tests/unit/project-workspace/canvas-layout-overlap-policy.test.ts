import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceCanvasLegacyLayoutModel,
  captureLayoutBasePositions,
  composeWorkspaceCanvasLegacyLayout,
} from '@/features/project-workspace/canvas/layout/workspace-layout-composer'
import type { WorkspaceCanvasFlowNode } from '@/features/project-workspace/canvas/node-canvas-types'
import { canvasLifecycle } from '../../helpers/workspace-canvas'

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
      kind: 'videoPlan',
      mediaLoadingContext: { styleImageUrl: null },
      layoutNodeType: 'videoPlan',
      targetType: 'videoSegment',
      targetId: input.id,
      title: input.id,
      eyebrow: '',
      body: '',
      meta: '',
      lifecycle: canvasLifecycle(),
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
      node({ id: 'video-segment:first-panel', x: 0, y: 0, width: 720, height: 560 }),
      node({ id: 'video-segment:second-panel', x: 120, y: 80, width: 420, height: 360 }),
    ]

    const layout = composeWorkspaceCanvasLegacyLayout({
      nodes,
      model: buildWorkspaceCanvasLegacyLayoutModel(nodes),
    })

    expect(findNode(layout, 'video-segment:first-panel').position).toEqual({ x: 0, y: 0 })
    expect(findNode(layout, 'video-segment:second-panel').position).toEqual({ x: 120, y: 80 })
  })

  it('captures only dragged nodes as new base positions', () => {
    const nodes = [
      node({ id: 'video-segment:dragged-panel', x: 40, y: 50, baseX: 0, baseY: 0 }),
      node({ id: 'video-segment:untouched-panel', x: 300, y: 200, baseX: 120, baseY: 90 }),
    ]

    const layout = captureLayoutBasePositions({
      nodes,
      nodeIds: new Set(['video-segment:dragged-panel']),
    })

    expect(findNode(layout, 'video-segment:dragged-panel').data.layoutBasePosition).toEqual({ x: 40, y: 50 })
    expect(findNode(layout, 'video-segment:untouched-panel').data.layoutBasePosition).toEqual({ x: 120, y: 90 })
  })

  it('keeps explicit preserved positions as base without moving other nodes', () => {
    const nodes = [
      node({ id: 'video-segment:preserved-panel', x: 0, y: 0 }),
      node({ id: 'video-segment:free-panel', x: 0, y: 0 }),
    ]
    const preservedNodePositions = new Map([
      ['video-segment:preserved-panel', { x: 480, y: 320 }],
    ])

    const layout = composeWorkspaceCanvasLegacyLayout({
      nodes,
      model: buildWorkspaceCanvasLegacyLayoutModel(nodes, { preservedNodePositions }),
      preservedNodePositions,
    })

    expect(findNode(layout, 'video-segment:preserved-panel').position).toEqual({ x: 480, y: 320 })
    expect(findNode(layout, 'video-segment:free-panel').position).toEqual({ x: 0, y: 0 })
  })
})
