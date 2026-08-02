import type { Edge, Node } from '@xyflow/react'
import type { CanvasLayoutNodeType } from '@/lib/project-canvas/layout/canvas-layout-contract'
import type { TaskRuntimeTarget } from '@/lib/task/runtime-targets'
import type { WorkspaceCanvasLifecycle } from './lifecycle/workspace-canvas-lifecycle'
import type { WorkspaceResourceCardView } from './contracts/workspace-canvas-interactions'

/**
 * Canvas projects durable Creative Resources. Resource schema and lineage,
 * rather than a workflow stage name, describe what each card represents.
 */
export type WorkspaceCanvasNodeKind = 'resourceCard' | 'folder'

/**
 * The shape a Resource card's media area takes, declared per media family in
 * the node presentation profile. `frame` keeps the project aspect ratio
 * (image/video), `bar` is a low strip (audio: music, ambience, voice
 * references), `card` is a fixed text panel. Projector and renderer only
 * consume the resolved shell; neither may branch on media type for sizing.
 */
export type WorkspaceCanvasMediaShellForm = 'frame' | 'bar' | 'card'

export interface WorkspaceCanvasMediaShell {
  readonly form: WorkspaceCanvasMediaShellForm
  readonly width: number
  readonly height: number
  readonly fit: 'cover' | 'contain'
}

interface WorkspaceCanvasBaseNodeData {
  readonly nodeId?: string
  readonly projectId?: string
  readonly kind: WorkspaceCanvasNodeKind
  readonly layoutNodeType: Extract<CanvasLayoutNodeType, 'resourceCard' | 'folder'>
  readonly targetType: 'workspaceResource' | 'folder'
  readonly targetId: string
  readonly title: string
  readonly eyebrow: string
  readonly lifecycle: WorkspaceCanvasLifecycle
  readonly runtimeTargets?: readonly TaskRuntimeTarget[]
  readonly width: number
  readonly height: number
  readonly layoutBasePosition?: {
    readonly x: number
    readonly y: number
  }
  readonly readOnly?: boolean
  /** Pure UI selection flag mirrored from the workspace selection state. */
  readonly uiSelected?: boolean
}

export interface WorkspaceCanvasResourceNodeData extends WorkspaceCanvasBaseNodeData {
  readonly kind: 'resourceCard'
  readonly layoutNodeType: 'resourceCard'
  readonly targetType: 'workspaceResource'
  readonly mediaShell: WorkspaceCanvasMediaShell
  readonly resourceDetails: WorkspaceResourceCardView
}

export interface WorkspaceCanvasFolderNodeData extends WorkspaceCanvasBaseNodeData {
  readonly kind: 'folder'
  readonly layoutNodeType: 'folder'
  readonly targetType: 'folder'
  readonly folder: {
    readonly resourceId: string
    readonly workspacePath: string
  }
}

export type WorkspaceCanvasNodeData =
  | WorkspaceCanvasResourceNodeData
  | WorkspaceCanvasFolderNodeData

export type WorkspaceCanvasNodeRecord =
  | (WorkspaceCanvasResourceNodeData & Record<string, unknown>)
  | (WorkspaceCanvasFolderNodeData & Record<string, unknown>)
export type WorkspaceCanvasFlowNode = Node<WorkspaceCanvasNodeRecord, 'workspaceNode'>
export type WorkspaceCanvasFlowEdge = Edge

export interface WorkspaceCanvasProjection {
  readonly nodes: readonly WorkspaceCanvasFlowNode[]
  readonly edges: readonly WorkspaceCanvasFlowEdge[]
}
