import { EditBibleContent } from '../WorkspaceNodeRenderers'
import type { WorkspaceCanvasNodeRendererProps } from './types'

export function EditBibleNodeRenderer({ data, labels, expanded }: WorkspaceCanvasNodeRendererProps) {
  return <EditBibleContent data={data} labels={labels} expanded={expanded} />
}
