import { describe, expect, it } from 'vitest'
import {
  applyWorkspaceCanvasRunningEdgeAnimation,
  buildWorkspaceCanvasFocusKey,
  getWorkspaceCanvasRunningNodeIds,
  resolveCanvasFocusFollowDecision,
} from '@/features/project-workspace/canvas/hooks/useCanvasFocusFollow'
import type {
  WorkspaceCanvasFlowEdge,
  WorkspaceCanvasFlowNode,
} from '@/features/project-workspace/canvas/node-canvas-types'

function workspaceNode(id: string, isRunning: boolean): WorkspaceCanvasFlowNode {
  return {
    id,
    type: 'workspaceNode',
    position: { x: 0, y: 0 },
    data: {
      kind: 'shot',
      layoutNodeType: 'shot',
      targetType: 'panel',
      targetId: id,
      title: id,
      eyebrow: 'Shot',
      body: 'body',
      meta: 'meta',
      statusLabel: isRunning ? 'Processing' : 'Ready',
      isRunning,
      width: 320,
      height: 420,
    },
  }
}

describe('workspace canvas focus follow', () => {
  it('uses currently running nodes as the only focus source', () => {
    const nodes = [
      workspaceNode('shot:panel-2', true),
      workspaceNode('shot:panel-1', true),
      workspaceNode('shot:panel-3', false),
    ]

    const runningNodeIds = getWorkspaceCanvasRunningNodeIds(nodes)

    expect(runningNodeIds).toEqual(['shot:panel-2', 'shot:panel-1'])
    expect(buildWorkspaceCanvasFocusKey(runningNodeIds)).toBe('shot:panel-1|shot:panel-2')
  })

  it('does not refocus the same running group after it has already focused', () => {
    expect(resolveCanvasFocusFollowDecision({
      focusKey: 'shot:panel-1',
      enabled: true,
      suppressedFocusKey: null,
      lastFocusedKey: 'shot:panel-1',
    })).toBe('skip_already_focused')
  })

  it('keeps user-suppressed running group pending but allows the next group to focus', () => {
    expect(resolveCanvasFocusFollowDecision({
      focusKey: 'shot:panel-1',
      enabled: true,
      suppressedFocusKey: 'shot:panel-1',
      lastFocusedKey: 'shot:panel-1',
    })).toBe('pending')

    expect(resolveCanvasFocusFollowDecision({
      focusKey: 'shot:panel-2',
      enabled: true,
      suppressedFocusKey: 'shot:panel-1',
      lastFocusedKey: 'shot:panel-1',
    })).toBe('focus')
  })

  it('keeps focus pending while auto follow is disabled', () => {
    expect(resolveCanvasFocusFollowDecision({
      focusKey: 'shot:panel-1',
      enabled: false,
      suppressedFocusKey: null,
      lastFocusedKey: null,
    })).toBe('pending')
  })

  it('animates only edges that point to running nodes', () => {
    const edges: WorkspaceCanvasFlowEdge[] = [
      { id: 'edge:a-b', source: 'a', target: 'b' },
      { id: 'edge:b-c', source: 'b', target: 'c', animated: true },
      { id: 'edge:c-d', source: 'c', target: 'd' },
    ]

    expect(applyWorkspaceCanvasRunningEdgeAnimation(edges, ['b'])).toEqual([
      { id: 'edge:a-b', source: 'a', target: 'b', animated: true },
      { id: 'edge:b-c', source: 'b', target: 'c', animated: false },
      { id: 'edge:c-d', source: 'c', target: 'd', animated: false },
    ])
  })
})
