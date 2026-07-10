import { EditShotExecutionPlanContent } from '../WorkspaceNodeRenderers'
import type { WorkspaceCanvasNodeRendererProps } from './types'

export function EditShotExecutionPlanNodeRenderer({ data, labels, expanded }: WorkspaceCanvasNodeRendererProps) {
  return <EditShotExecutionPlanContent data={data} labels={labels} expanded={expanded} />
}
