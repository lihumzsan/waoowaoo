import { describe, expect, it } from 'vitest'
import type { WorkspaceCanvasFlowNode, WorkspaceCanvasNodeKind } from '@/features/project-workspace/canvas/node-canvas-types'
import type { CanvasLayoutNodeType } from '@/lib/project-canvas/layout/canvas-layout-contract'
import {
  buildWorkspaceCanvasLayoutModel,
  resolveWorkspaceCanvasLayoutLane,
} from '@/features/project-workspace/canvas/layout/workspace-layout-model'

function createNode(input: {
  readonly id: string
  readonly kind: WorkspaceCanvasNodeKind
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
  readonly layoutBasePosition?: { readonly x: number; readonly y: number }
  readonly targetType?: WorkspaceCanvasFlowNode['data']['targetType']
  readonly targetId?: string
  readonly storyboardId?: string
}): WorkspaceCanvasFlowNode {
  const width = input.width ?? 100
  const height = input.height ?? 120
  const layoutNodeType: CanvasLayoutNodeType = input.kind
  return {
    id: input.id,
    type: 'workspaceNode',
    position: { x: input.x ?? 0, y: input.y ?? 0 },
    style: { width, height },
    data: {
      kind: input.kind,
      layoutNodeType,
      targetType: input.targetType ?? 'panel',
      targetId: input.targetId ?? input.id,
      storyboardId: input.storyboardId,
      title: input.id,
      eyebrow: 'node',
      body: 'body',
      meta: 'meta',
      statusLabel: 'ready',
      width,
      height,
      layoutBasePosition: input.layoutBasePosition,
    },
  }
}

describe('workspace layout model', () => {
  it('assigns stable business lanes for every workspace node kind', () => {
    expect(resolveWorkspaceCanvasLayoutLane('analysis')).toBe('story')
    expect(resolveWorkspaceCanvasLayoutLane('editPipelineStep')).toBe('editPipeline')
    expect(resolveWorkspaceCanvasLayoutLane('editScript')).toBe('editScript')
    expect(resolveWorkspaceCanvasLayoutLane('editRequiredAsset')).toBe('assets')
    expect(resolveWorkspaceCanvasLayoutLane('spaceConsistency')).toBe('spaceConsistency')
    expect(resolveWorkspaceCanvasLayoutLane('storyboardPanelGeneration')).toBe('shots')
    expect(resolveWorkspaceCanvasLayoutLane('shot')).toBe('shots')
    expect(resolveWorkspaceCanvasLayoutLane('videoPlan')).toBe('videoPlan')
    expect(resolveWorkspaceCanvasLayoutLane('bgmScore')).toBe('bgm')
    expect(resolveWorkspaceCanvasLayoutLane('finalTimeline')).toBe('final')
  })

  it('groups storyboard panel generation nodes with their storyboard shot lane', () => {
    const model = buildWorkspaceCanvasLayoutModel({
      nodes: [
        createNode({
          id: 'storyboard-panel-generation:storyboard-1',
          kind: 'storyboardPanelGeneration',
          targetType: 'storyboardPanelGeneration',
          targetId: 'storyboard-1',
          storyboardId: 'storyboard-1',
        }),
      ],
    })

    expect(model.nodes[0]).toMatchObject({
      lane: 'shots',
      groupId: 'shots:storyboard-1',
      targetType: 'storyboardPanelGeneration',
      targetId: 'storyboard-1',
    })
  })

  it('keeps baseline position, order, and measured size separate from render nodes', () => {
    const nodes = [
      createNode({
        id: 'edit-script',
        kind: 'editScript',
        x: 10,
        y: 20,
        width: 300,
        height: 400,
        layoutBasePosition: { x: 100, y: 200 },
      }),
      createNode({ id: 'video-plan', kind: 'videoPlan', x: 500, y: 600 }),
    ]
    const measuredNodeSizes = new Map([['edit-script', { width: 320, height: 460 }]])

    const model = buildWorkspaceCanvasLayoutModel({
      nodes,
      measuredNodeSizes,
      fixedAnchorPositions: new Map([['video-plan', { x: 540, y: 640 }]]),
    })

    expect(model.nodes[0]).toMatchObject({
      id: 'edit-script',
      lane: 'editScript',
      groupId: 'editScript',
      order: 0,
      estimatedSize: { width: 300, height: 400 },
      measuredSize: { width: 320, height: 460 },
      basePosition: { x: 100, y: 200 },
      anchorMode: 'none',
    })
    expect(model.nodes[1]).toMatchObject({
      id: 'video-plan',
      lane: 'videoPlan',
      order: 1,
      basePosition: { x: 540, y: 640 },
      anchorMode: 'fixed',
    })
    expect(model.layoutEdges).toEqual([])
  })

  it('only includes explicit layout edges instead of implicitly reusing render edges', () => {
    const nodes = [
      createNode({ id: 'source', kind: 'shot' }),
      createNode({ id: 'target', kind: 'shot' }),
    ]

    const model = buildWorkspaceCanvasLayoutModel({
      nodes,
      layoutEdges: [
        { id: 'visible-edge', source: 'source', target: 'target' },
        { id: 'missing-edge', source: 'source', target: 'missing' },
      ],
    })

    expect(model.layoutEdges).toEqual([{ id: 'visible-edge', source: 'source', target: 'target' }])
  })
})
