import type { WorkspaceCanvasFlowNode } from '../node-canvas-types'
import { ResourceCardContent } from './renderers/resource-card'
import type { WorkspaceCanvasNodeRenderer, WorkspaceCanvasNodeRendererProps } from './renderers/types'

export const WORKSPACE_CANVAS_NODE_RENDERERS = {
  resourceCard: ResourceCardContent,
} satisfies Record<WorkspaceCanvasFlowNode['data']['kind'], WorkspaceCanvasNodeRenderer>

export function NodeContent(props: WorkspaceCanvasNodeRendererProps) {
  const Renderer = WORKSPACE_CANVAS_NODE_RENDERERS[props.data.kind]
  return <Renderer {...props} />
}
