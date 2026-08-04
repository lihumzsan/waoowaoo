import type { WorkspaceCanvasProjection } from '../node-canvas-types'
import {
  createWorkspaceNodeProjectionContext,
  type BuildWorkspaceNodeCanvasProjectionInput,
} from './workspace-node-projection-shared'
import { appendWorkspaceResourceProjection } from './workspace-node-resource-projection'

export type { BuildWorkspaceNodeCanvasProjectionInput } from './workspace-node-projection-shared'

export function buildWorkspaceNodeCanvasProjection(
  input: BuildWorkspaceNodeCanvasProjectionInput,
): WorkspaceCanvasProjection {
  const context = createWorkspaceNodeProjectionContext(input)
  appendWorkspaceResourceProjection(context)
  return { nodes: context.nodes, edges: context.edges }
}
