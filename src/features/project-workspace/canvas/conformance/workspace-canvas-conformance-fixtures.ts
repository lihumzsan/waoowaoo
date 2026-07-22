import type { WorkspaceCanvasNodeKind } from '../node-canvas-types'

export interface WorkspaceCanvasConformanceFixture<K extends WorkspaceCanvasNodeKind = WorkspaceCanvasNodeKind> {
  readonly kind: K
  readonly canonicalNodeId: string
  readonly taskTarget: {
    readonly targetType: 'CreativeResource'
    readonly targetId: string
    readonly taskType: string
  }
}

export const WORKSPACE_CANVAS_CONFORMANCE_FIXTURES = {
  resourceCard: {
    kind: 'resourceCard',
    canonicalNodeId: 'resource:conformance-resource',
    taskTarget: {
      targetType: 'CreativeResource',
      targetId: 'conformance-resource',
      taskType: 'creative_resource_image',
    },
  },
} as const satisfies Record<WorkspaceCanvasNodeKind, WorkspaceCanvasConformanceFixture>
