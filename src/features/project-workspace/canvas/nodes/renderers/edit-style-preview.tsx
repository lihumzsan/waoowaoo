import { StyleBibleContent } from '../WorkspaceNodeRenderers'
import type { WorkspaceCanvasNodeRendererProps } from './types'

export function EditStylePreviewNodeRenderer({ data, labels, expanded }: WorkspaceCanvasNodeRendererProps) {
  return <StyleBibleContent data={data} labels={labels} expanded={expanded} />
}
