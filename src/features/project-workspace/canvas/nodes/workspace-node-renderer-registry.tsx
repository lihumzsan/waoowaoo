import type { WorkspaceCanvasFlowNode } from '../node-canvas-types'
import { MediaPreview } from './WorkspaceNodeRenderers'
import { BgmScoreNodeRenderer } from './renderers/bgm-score'
import { EditAssetGroupNodeRenderer } from './renderers/edit-asset-group'
import { EditBibleNodeRenderer } from './renderers/edit-bible'
import { EditPipelineStepNodeRenderer } from './renderers/edit-pipeline-step'
import { EditProcessGroupNodeRenderer } from './renderers/edit-process-group'
import { EditRequiredAssetNodeRenderer } from './renderers/edit-required-asset'
import { EditScriptNodeRenderer } from './renderers/edit-script'
import { EditShotExecutionPlanNodeRenderer } from './renderers/edit-shot-execution-plan'
import { EditSourceScriptNodeRenderer } from './renderers/edit-source-script'
import { EditStyleBibleNodeRenderer } from './renderers/edit-style-bible'
import { EditStylePreviewNodeRenderer } from './renderers/edit-style-preview'
import { FinalTimelineNodeRenderer } from './renderers/final-timeline'
import { ImageAssetNodeRenderer } from './renderers/image-asset'
import { ShotNodeRenderer } from './renderers/shot'
import { SoundscapeNodeRenderer } from './renderers/soundscape'
import type { WorkspaceCanvasNodeRenderer, WorkspaceCanvasNodeRendererProps } from './renderers/types'
import { VideoClipNodeRenderer } from './renderers/video-clip'
import { VideoPlanNodeRenderer } from './renderers/video-plan'

export const WORKSPACE_CANVAS_NODE_RENDERERS = {
  shot: ShotNodeRenderer,
  imageAsset: ImageAssetNodeRenderer,
  videoClip: VideoClipNodeRenderer,
  finalTimeline: FinalTimelineNodeRenderer,
  editSourceScript: EditSourceScriptNodeRenderer,
  editBible: EditBibleNodeRenderer,
  editStylePreview: EditStylePreviewNodeRenderer,
  editStyleBible: EditStyleBibleNodeRenderer,
  editPipelineStep: EditPipelineStepNodeRenderer,
  editProcessGroup: EditProcessGroupNodeRenderer,
  editScript: EditScriptNodeRenderer,
  editShotExecutionPlan: EditShotExecutionPlanNodeRenderer,
  videoPlan: VideoPlanNodeRenderer,
  bgmScore: BgmScoreNodeRenderer,
  soundscape: SoundscapeNodeRenderer,
  editRequiredAsset: EditRequiredAssetNodeRenderer,
  editAssetGroup: EditAssetGroupNodeRenderer,
} satisfies Record<WorkspaceCanvasFlowNode['data']['kind'], WorkspaceCanvasNodeRenderer>

export function NodeContent({ data, labels, expanded }: WorkspaceCanvasNodeRendererProps) {
  if (
    data.__running === true
    && (data.kind === 'imageAsset' || data.kind === 'videoClip' || data.kind === 'editRequiredAsset')
  ) {
    return <MediaPreview data={data} />
  }
  const Renderer = WORKSPACE_CANVAS_NODE_RENDERERS[data.kind]
  return <Renderer data={data} labels={labels} expanded={expanded} />
}
