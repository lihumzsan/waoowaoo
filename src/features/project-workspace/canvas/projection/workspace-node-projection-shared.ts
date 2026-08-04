import type { CSSProperties } from 'react'
import type { CanvasNodeLayout } from '@/lib/project-canvas/layout/canvas-layout.types'
import type { WorkspaceResourceView } from '@/lib/workspace-resource/contracts'
import type {
  WorkspaceCanvasFlowEdge,
  WorkspaceCanvasFlowNode,
  WorkspaceCanvasFolderNodeData,
  WorkspaceCanvasNodeRecord,
  WorkspaceCanvasResourceNodeData,
} from '../node-canvas-types'

interface TranslateValues {
  readonly [key: string]: string | number
}

type Translate = (key: string, values?: TranslateValues) => string

export interface BuildWorkspaceNodeCanvasProjectionInput {
  readonly projectId?: string
  /** Project `videoRatio` (`W:H`); media frame cards derive their size from it. */
  readonly projectAspectRatio?: string | null
  /** Current canvas folder path (`null` = project root); subtree rows resolve against it. */
  readonly currentFolderPath?: string | null
  /** Folders already collapsed in this canvas session (monotonic, see expansion policy). */
  readonly collapsedSeed?: ReadonlySet<string>
  readonly workspaceResources?: readonly WorkspaceResourceView[]
  readonly savedLayouts: readonly CanvasNodeLayout[]
  readonly translate: Translate
}

export function createWorkspaceNodeProjectionContext(input: BuildWorkspaceNodeCanvasProjectionInput) {
  return {
    projectId: input.projectId,
    projectAspectRatio: input.projectAspectRatio ?? null,
    currentFolderPath: input.currentFolderPath ?? null,
    collapsedSeed: input.collapsedSeed,
    workspaceResources: input.workspaceResources ?? [],
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
  readonly data:
    | Omit<WorkspaceCanvasResourceNodeData, 'nodeId' | 'width' | 'height'>
    | Omit<WorkspaceCanvasFolderNodeData, 'nodeId' | 'width' | 'height'>
  readonly width: number
  readonly height: number
  /** Section membership: children live in their section frame's coordinates. */
  readonly parentId?: string
  readonly draggable?: boolean
}): WorkspaceCanvasFlowNode {
  const data = {
    ...input.data,
    nodeId: input.id,
    width: input.width,
    height: input.height,
    layoutBasePosition: input.position,
  } as WorkspaceCanvasNodeRecord
  const style: CSSProperties = { width: input.width, height: input.height }
  return {
    id: input.id,
    type: 'workspaceNode',
    position: input.position,
    style,
    data,
    ...(input.parentId ? { parentId: input.parentId } : {}),
    ...(input.draggable === undefined ? {} : { draggable: input.draggable }),
  }
}
