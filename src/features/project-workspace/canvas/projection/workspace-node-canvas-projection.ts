import type { WorkspaceCanvasProjection } from '../node-canvas-types'
import { createWorkspaceNodeProjectionContext, type BuildWorkspaceNodeCanvasProjectionInput } from './workspace-node-projection-shared'
import { appendWorkspacePlanningProjection } from './workspace-node-planning-projection'
import { appendWorkspaceAssetExecutionProjection } from './workspace-node-asset-execution-projection'
import { appendWorkspaceStoryboardProjection } from './workspace-node-storyboard-projection'
import { appendWorkspaceAudioFinalProjection } from './workspace-node-audio-final-projection'

export type { BuildWorkspaceNodeCanvasProjectionInput } from './workspace-node-projection-shared'

export function buildWorkspaceNodeCanvasProjection(input: BuildWorkspaceNodeCanvasProjectionInput): WorkspaceCanvasProjection {
  const context = createWorkspaceNodeProjectionContext(input)
  const planning = appendWorkspacePlanningProjection(context)
  const assetExecution = appendWorkspaceAssetExecutionProjection(context, planning)
  const storyboard = appendWorkspaceStoryboardProjection(context, planning, assetExecution)
  appendWorkspaceAudioFinalProjection(context, storyboard)
  return { nodes: context.nodes, edges: context.edges }
}
