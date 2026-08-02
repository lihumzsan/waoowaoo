import type { UpsertCanvasLayoutInput } from '@/lib/project-canvas/layout/canvas-layout-contract'
import type { Viewport } from '@xyflow/react'
import { DEFAULT_WORKSPACE_CANVAS_VIEWPORT } from './canvasViewport'
import type { WorkspaceCanvasFlowNode } from './node-canvas-types'

export function buildWorkspaceCanvasLayoutInput(params: {
  readonly folderKey: string
  readonly viewport?: Viewport
  readonly nodes: readonly WorkspaceCanvasFlowNode[]
}): UpsertCanvasLayoutInput {
  return {
    folderKey: params.folderKey,
    viewport: params.viewport ?? DEFAULT_WORKSPACE_CANVAS_VIEWPORT,
    nodeLayouts: params.nodes.map((node, index) => ({
      nodeKey: node.id,
      nodeType: node.data.layoutNodeType,
      targetType: node.data.targetType,
      targetId: node.data.targetId,
      x: node.position.x,
      y: node.position.y,
      width: node.data.width,
      height: node.data.height,
      zIndex: typeof node.zIndex === 'number' ? node.zIndex : index,
      locked: false,
      collapsed: false,
    })),
  }
}
