import type { WorkspaceCanvasNodeKind } from '../node-canvas-types'

export interface WorkspaceCanvasConformanceFixture<K extends WorkspaceCanvasNodeKind = WorkspaceCanvasNodeKind> {
  readonly kind: K
  readonly canonicalNodeId: string
  readonly taskTarget: {
    readonly targetType: 'WorkspaceResource'
    readonly targetId: string
    readonly taskType: string
  } | null
}

export const WORKSPACE_CANVAS_CONFORMANCE_FIXTURES = {
  resourceCard: {
    kind: 'resourceCard',
    canonicalNodeId: 'resource:conformance-resource',
    taskTarget: {
      targetType: 'WorkspaceResource',
      targetId: 'conformance-resource',
      taskType: 'workspace_resource_image',
    },
  },
  folder: {
    kind: 'folder',
    canonicalNodeId: 'folder:conformance-folder',
    taskTarget: null,
  },
} as const satisfies Record<WorkspaceCanvasNodeKind, WorkspaceCanvasConformanceFixture>
