import { EditPipelineStepContent } from '../WorkspaceNodeRenderers'
import type { WorkspaceCanvasNodeRendererProps } from './types'

export function EditPipelineStepNodeRenderer({ data, labels, expanded }: WorkspaceCanvasNodeRendererProps) {
  return <EditPipelineStepContent data={data} labels={labels} expanded={expanded} />
}
