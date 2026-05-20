import { describe, expect, it } from 'vitest'
import { buildWorkspaceCanvasLayoutInput } from '@/features/project-workspace/canvas/canvasLayoutInput'
import { DEFAULT_WORKSPACE_CANVAS_VIEWPORT } from '@/features/project-workspace/canvas/canvasViewport'
import type { WorkspaceCanvasFlowNode } from '@/features/project-workspace/canvas/node-canvas-types'

function canvasNode(input: {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly zIndex?: number
}): WorkspaceCanvasFlowNode {
  return {
    id: input.id,
    type: 'workspaceNode',
    position: { x: input.x, y: input.y },
    zIndex: input.zIndex,
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
      height: 214,
    },
  }
}

describe('workspace canvas layout input', () => {
  it('does not persist local pan or zoom into the shared layout payload', () => {
    const input = buildWorkspaceCanvasLayoutInput({
      episodeId: 'episode-1',
      nodes: [canvasNode({ id: 'shot:panel-1', x: 120, y: 240, zIndex: 7 })],
    })

    expect(input.viewport).toEqual(DEFAULT_WORKSPACE_CANVAS_VIEWPORT)
    expect(input.nodeLayouts).toEqual([{
      nodeKey: 'shot:panel-1',
      nodeType: 'shot',
      targetType: 'panel',
      targetId: 'shot:panel-1',
      x: 120,
      y: 240,
      width: 320,
      height: 214,
      zIndex: 7,
      locked: false,
      collapsed: false,
    }])
  })
})
