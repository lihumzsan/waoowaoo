import { describe, expect, it } from 'vitest'

import {
  buildWorkspaceCanvasFocusKey,
  resolveCanvasFocusFollowDecision,
  resolveWorkspaceCanvasFocusNodeIds,
  resolveWorkspaceCanvasStyleBibleFocusNodeIds,
} from '@/features/project-workspace/canvas/hooks/useCanvasFocusFollow'

import type { WorkspaceCanvasFlowNode } from '@/features/project-workspace/canvas/node-canvas-types'

import { canvasLifecycle } from '../../helpers/workspace-canvas'

function workspaceNode(
  id: string,
  kind: WorkspaceCanvasFlowNode['data']['kind'],
  isRunning: boolean,
): WorkspaceCanvasFlowNode {
  return {
    id,
    type: 'workspaceNode',
    position: { x: 0, y: 0 },
    data: {
      kind,
      mediaLoadingContext: null,
      layoutNodeType: kind,
      targetType: 'panel',
      targetId: id,
      title: id,
      eyebrow: 'Shot',
      body: 'body',
      meta: 'meta',
      lifecycle: canvasLifecycle(isRunning ? 'processing' : 'succeeded'),
      width: 320,
      height: 420,
    },
  }
}

export { describe, expect, it } from 'vitest'
export { buildWorkspaceCanvasFocusKey, resolveCanvasFocusFollowDecision, resolveWorkspaceCanvasFocusNodeIds, resolveWorkspaceCanvasStyleBibleFocusNodeIds } from '@/features/project-workspace/canvas/hooks/useCanvasFocusFollow'
export type { WorkspaceCanvasFlowNode } from '@/features/project-workspace/canvas/node-canvas-types'
export { canvasLifecycle } from '../../helpers/workspace-canvas'
export { workspaceNode }
