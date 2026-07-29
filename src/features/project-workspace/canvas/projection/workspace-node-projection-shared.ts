import type { CSSProperties } from 'react'
import type { CanvasNodeLayout } from '@/lib/project-canvas/layout/canvas-layout.types'
import type { CreativeResourceCardView } from '@/lib/creative-resource/contracts'
import type {
  WorkspaceCanvasFlowEdge,
  WorkspaceCanvasFlowNode,
  WorkspaceCanvasNodeData,
  WorkspaceCanvasNodeRecord,
} from '../node-canvas-types'

interface TranslateValues {
  readonly [key: string]: string | number
}

type Translate = (key: string, values?: TranslateValues) => string

export interface BuildWorkspaceNodeCanvasProjectionInput {
  readonly projectId?: string
  readonly episodeName?: string
  /** Project `videoRatio` (`W:H`); media frame cards derive their size from it. */
  readonly projectAspectRatio?: string | null
  readonly creativeResources?: readonly CreativeResourceCardView[]
  readonly savedLayouts: readonly CanvasNodeLayout[]
  readonly translate: Translate
}

export function createWorkspaceNodeProjectionContext(input: BuildWorkspaceNodeCanvasProjectionInput) {
  return {
    projectId: input.projectId,
    episodeName: input.episodeName,
    projectAspectRatio: input.projectAspectRatio ?? null,
    creativeResources: input.creativeResources ?? [],
    savedLayouts: input.savedLayouts,
    translate: input.translate,
    nodes: [] as WorkspaceCanvasFlowNode[],
    edges: [] as WorkspaceCanvasFlowEdge[],
  }
}

export type WorkspaceNodeProjectionContext = ReturnType<typeof createWorkspaceNodeProjectionContext>

export function layoutPosition(
  savedLayouts: readonly CanvasNodeLayout[],
  nodeId: string,
  fallback: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } {
  const saved = savedLayouts.find((layout) => layout.nodeKey === nodeId)
  return saved ? { x: saved.x, y: saved.y } : fallback
}

export function createEdge(id: string, source: string, target: string): WorkspaceCanvasFlowEdge {
  return { id, source, target, type: 'smoothstep', animated: false }
}

export function createNode(input: {
  readonly id: string
  readonly position: { readonly x: number; readonly y: number }
  readonly data: Omit<WorkspaceCanvasNodeData, 'nodeId' | 'width' | 'height'>
  readonly width: number
  readonly height: number
}): WorkspaceCanvasFlowNode {
  const data: WorkspaceCanvasNodeRecord = {
    ...input.data,
    nodeId: input.id,
    width: input.width,
    height: input.height,
    layoutBasePosition: input.position,
  }
  const style: CSSProperties = { width: input.width, height: input.height }
  return {
    id: input.id,
    type: 'workspaceNode',
    position: input.position,
    style,
    data,
  }
}
