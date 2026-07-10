import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceCanvasEdgeSignature,
  buildWorkspaceCanvasNodeSignature,
} from '@/features/project-workspace/canvas/hooks/canvas-projection-signature'
import type {
  WorkspaceCanvasFlowEdge,
  WorkspaceCanvasFlowNode,
} from '@/features/project-workspace/canvas/node-canvas-types'

function createNode(input: {
  readonly id: string
  readonly title?: string
  readonly x?: number
  readonly onAction?: () => void
}): WorkspaceCanvasFlowNode {
  return {
    id: input.id,
    type: 'workspaceNode',
    position: { x: input.x ?? 1, y: 2 },
    data: {
      kind: 'shot',
      mediaLoadingContext: { styleImageUrl: null },
      layoutNodeType: 'shot',
      targetType: 'panel',
      targetId: 'panel-1',
      title: input.title ?? 'Shot',
      eyebrow: 'eyebrow',
      body: 'body',
      meta: 'meta',
      statusLabel: 'ready',
      width: 320,
      height: 380,
      onAction: input.onAction,
    },
  }
}

function createEdge(id: string): WorkspaceCanvasFlowEdge {
  return {
    id,
    source: 'source',
    target: 'target',
    type: 'smoothstep',
  }
}

describe('canvas projection signature', () => {
  it('keeps node signatures stable when only action handler identity changes', () => {
    const left = buildWorkspaceCanvasNodeSignature([
      createNode({ id: 'shot:1', onAction: () => undefined }),
    ])
    const right = buildWorkspaceCanvasNodeSignature([
      createNode({ id: 'shot:1', onAction: () => undefined }),
    ])

    expect(right).toBe(left)
  })

  it('changes node signatures for visible node content or layout changes', () => {
    const base = buildWorkspaceCanvasNodeSignature([createNode({ id: 'shot:1' })])
    const renamed = buildWorkspaceCanvasNodeSignature([createNode({ id: 'shot:1', title: 'New shot' })])
    const moved = buildWorkspaceCanvasNodeSignature([createNode({ id: 'shot:1', x: 42 })])

    expect(renamed).not.toBe(base)
    expect(moved).not.toBe(base)
  })

  it('changes edge signatures only when edge content changes', () => {
    const base = buildWorkspaceCanvasEdgeSignature([createEdge('edge-1')])
    const same = buildWorkspaceCanvasEdgeSignature([createEdge('edge-1')])
    const changed = buildWorkspaceCanvasEdgeSignature([createEdge('edge-2')])

    expect(same).toBe(base)
    expect(changed).not.toBe(base)
  })
})
