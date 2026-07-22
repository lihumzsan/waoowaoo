import { describe, expect, it } from 'vitest'
import { buildWorkspaceCanvasLayoutInput } from '@/features/project-workspace/canvas/canvasLayoutInput'
import { DEFAULT_WORKSPACE_CANVAS_VIEWPORT } from '@/features/project-workspace/canvas/canvasViewport'
import type { WorkspaceCanvasFlowNode } from '@/features/project-workspace/canvas/node-canvas-types'
import type { CreativeResourceCardView } from '@/lib/creative-resource/contracts'
import { canvasLifecycle } from '../../helpers/workspace-canvas'

function canvasNode(input: {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly zIndex?: number
  readonly kind?: WorkspaceCanvasFlowNode['data']['kind']
  readonly targetType?: WorkspaceCanvasFlowNode['data']['targetType']
  readonly targetId?: string
}): WorkspaceCanvasFlowNode {
  const kind = input.kind ?? 'resourceCard'
  return {
    id: input.id,
    type: 'workspaceNode',
    position: { x: input.x, y: input.y },
    zIndex: input.zIndex,
    data: {
      kind,
      mediaLoadingContext: null,
      layoutNodeType: kind,
      targetType: input.targetType ?? 'creativeResource',
      targetId: input.targetId ?? input.id,
      title: input.id,
      eyebrow: '',
      body: '',
      meta: '',
      lifecycle: canvasLifecycle(),
      resourceDetails: {} as CreativeResourceCardView,
      width: 320,
      height: 214,
    },
  }
}

describe('workspace canvas layout input', () => {
  it('does not persist local pan or zoom into the shared layout payload', () => {
    const input = buildWorkspaceCanvasLayoutInput({
      episodeId: 'episode-1',
      nodes: [canvasNode({ id: 'resource:resource-1', x: 120, y: 240, zIndex: 7 })],
    })

    expect(input.viewport).toEqual(DEFAULT_WORKSPACE_CANVAS_VIEWPORT)
    expect(input.nodeLayouts).toEqual([{
      nodeKey: 'resource:resource-1',
      nodeType: 'resourceCard',
      targetType: 'creativeResource',
      targetId: 'resource:resource-1',
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
