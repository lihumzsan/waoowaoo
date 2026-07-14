import type { WorkspaceCanvasFlowNode } from '../node-canvas-types'
import { EditAssetContent, EditAssetGroupContent, StyleBibleContent } from './renderers/assets-style'
import { BgmScoreContent, FinalContent, AmbientSoundContent } from './renderers/audio-final'
import { EditBibleContent, SourceScriptContent } from './renderers/bible'
import { EditScriptContent, EditShotExecutionPlanContent } from './renderers/edit-plans'
import { MediaPreview } from './renderers/media'
import { EditPipelineStepContent, ProcessGroupContent } from './renderers/pipeline'
import { nodeIsRunning } from './renderers/renderer-shared'
import type { WorkspaceCanvasNodeRenderer, WorkspaceCanvasNodeRendererProps } from './renderers/types'
import { VideoPlanContent } from './renderers/video-plan'
import { getWorkspaceCanvasNodeDefinition } from '../registry/workspace-canvas-node-registry'

export const WORKSPACE_CANVAS_NODE_RENDERERS = {
  finalTimeline: FinalContent,
  editSourceScript: SourceScriptContent,
  editBible: EditBibleContent,
  editStyleBible: StyleBibleContent,
  editPipelineStep: EditPipelineStepContent,
  editProcessGroup: ProcessGroupContent,
  editScript: EditScriptContent,
  editShotExecutionPlan: EditShotExecutionPlanContent,
  videoPlan: VideoPlanContent,
  bgmScore: BgmScoreContent,
  ambientSound: AmbientSoundContent,
  editRequiredAsset: EditAssetContent,
  editAssetGroup: EditAssetGroupContent,
} satisfies Record<WorkspaceCanvasFlowNode['data']['kind'], WorkspaceCanvasNodeRenderer>

export function NodeContent({ data, labels, expanded }: WorkspaceCanvasNodeRendererProps) {
  if (
    nodeIsRunning(data) &&
    getWorkspaceCanvasNodeDefinition(data.kind).presentation.runningRenderer === 'mediaPreview'
  ) {
    return <MediaPreview data={data} />
  }
  const Renderer = WORKSPACE_CANVAS_NODE_RENDERERS[data.kind]
  return <Renderer data={data} labels={labels} expanded={expanded} />
}
