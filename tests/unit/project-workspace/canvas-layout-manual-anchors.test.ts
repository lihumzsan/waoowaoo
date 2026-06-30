import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceCanvasLegacyLayoutModel,
  composeWorkspaceCanvasLegacyLayout,
} from '@/features/project-workspace/canvas/layout/workspace-layout-composer'
import type { WorkspaceCanvasFlowNode } from '@/features/project-workspace/canvas/node-canvas-types'

function node(id: string, y: number): WorkspaceCanvasFlowNode {
  return {
    id,
    type: 'workspaceNode',
    position: { x: 0, y },
    style: { width: 320, height: 240 },
    data: {
      kind: 'shot',
      layoutNodeType: 'shot',
      targetType: 'panel',
      targetId: id,
      title: id,
      eyebrow: '',
      body: '',
      meta: '',
      statusLabel: '',
      width: 320,
      height: 240,
      layoutBasePosition: { x: 0, y },
    },
  }
}

describe('workspace canvas manual layout anchors', () => {
  it('keeps saved node positions fixed while repairing non-manual overlaps', () => {
    const nodes = [
      node('shot:manual-panel', 0),
      node('shot:auto-panel', 0),
    ]
    const preservedNodePositions = new Map([
      ['shot:manual-panel', { x: 0, y: 0 }],
    ])

    const layout = composeWorkspaceCanvasLegacyLayout({
      nodes,
      model: buildWorkspaceCanvasLegacyLayoutModel(nodes, { preservedNodePositions }),
      preservedNodePositions,
    })

    expect(layout.find((item) => item.id === 'shot:manual-panel')?.position).toEqual({ x: 0, y: 0 })
    expect(layout.find((item) => item.id === 'shot:auto-panel')?.position.y).toBeGreaterThan(0)
  })
})
