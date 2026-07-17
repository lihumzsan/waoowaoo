import type { WorkspaceCanvasProjection } from '../node-canvas-types'
import { createWorkspaceNodeProjectionContext, type BuildWorkspaceNodeCanvasProjectionInput } from './workspace-node-projection-shared'
import { appendWorkspacePlanningProjection } from './workspace-node-planning-projection'
import { appendWorkspaceAssetExecutionProjection } from './workspace-node-asset-execution-projection'
import { appendWorkspaceVideoSegmentProjection } from './workspace-node-video-segment-projection'
import { appendWorkspaceAudioFinalProjection } from './workspace-node-audio-final-projection'
import { appendWorkspaceResourceProjection } from './workspace-node-resource-projection'

export type { BuildWorkspaceNodeCanvasProjectionInput } from './workspace-node-projection-shared'

export function buildWorkspaceNodeCanvasProjection(input: BuildWorkspaceNodeCanvasProjectionInput): WorkspaceCanvasProjection {
  const context = createWorkspaceNodeProjectionContext(input)
  appendWorkspacePlanningProjection(context)
  appendWorkspaceAssetExecutionProjection(context)
  const videoSegments = appendWorkspaceVideoSegmentProjection(context)
  appendWorkspaceAudioFinalProjection(context, videoSegments)
  appendWorkspaceResourceProjection(context)
  return { nodes: context.nodes, edges: context.edges }
}
