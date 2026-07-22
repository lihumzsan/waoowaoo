import type { Edge, Node } from '@xyflow/react'
import type { CanvasLayoutNodeType } from '@/lib/project-canvas/layout/canvas-layout-contract'
import type { CreativeResourceCardView } from '@/lib/creative-resource/contracts'
import type { TaskRuntimeTarget } from '@/lib/task/runtime-targets'
import type { WorkspaceCanvasLifecycle } from './lifecycle/workspace-canvas-lifecycle'

/**
 * Canvas projects durable Creative Resources. Resource schema and lineage,
 * rather than a workflow stage name, describe what each card represents.
 */
export type WorkspaceCanvasNodeKind = 'resourceCard'

export interface WorkspaceCanvasNodeDisclosureState {
  readonly canToggle: boolean
  readonly effectiveExpanded: boolean
  readonly mode: 'collapsed' | 'expanded'
}

export interface WorkspaceCanvasNodeData {
  readonly nodeId?: string
  readonly projectId?: string
  readonly episodeName?: string
  readonly kind: WorkspaceCanvasNodeKind
  readonly layoutNodeType: Extract<CanvasLayoutNodeType, 'resourceCard'>
  readonly targetType: 'creativeResource'
  readonly targetId: string
  readonly title: string
  readonly eyebrow: string
  readonly body: string
  readonly meta: string
  readonly lifecycle: WorkspaceCanvasLifecycle
  readonly focusHighlighted?: boolean
  readonly disclosure?: WorkspaceCanvasNodeDisclosureState
  readonly runtimeTargets?: readonly TaskRuntimeTarget[]
  readonly width: number
  readonly height: number
  readonly layoutBasePosition?: {
    readonly x: number
    readonly y: number
  }
  readonly readOnly?: boolean
  readonly expanded?: boolean
  readonly expandedLayout?: 'stack' | 'wide'
  readonly defaultExpanded?: boolean
  readonly onToggleExpanded?: (nodeId: string) => void
  readonly resourceDetails: CreativeResourceCardView
}

export type WorkspaceCanvasNodeRecord = WorkspaceCanvasNodeData & Record<string, unknown>
export type WorkspaceCanvasFlowNode = Node<WorkspaceCanvasNodeRecord, 'workspaceNode'>
export type WorkspaceCanvasFlowEdge = Edge

export interface WorkspaceCanvasProjection {
  readonly nodes: readonly WorkspaceCanvasFlowNode[]
  readonly edges: readonly WorkspaceCanvasFlowEdge[]
}
