import { ProcessGroupContent } from '../WorkspaceNodeRenderers'
import type { WorkspaceCanvasNodeRendererProps } from './types'

export function EditProcessGroupNodeRenderer({ data, labels, expanded }: WorkspaceCanvasNodeRendererProps) {
  return <ProcessGroupContent data={data} labels={labels} expanded={expanded} />
}
