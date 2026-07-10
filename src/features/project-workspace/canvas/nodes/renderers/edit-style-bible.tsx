import { StyleBibleContent } from '../WorkspaceNodeRenderers'
import type { WorkspaceCanvasNodeRendererProps } from './types'

export function EditStyleBibleNodeRenderer({ data, labels, expanded }: WorkspaceCanvasNodeRendererProps) {
  return <StyleBibleContent data={data} labels={labels} expanded={expanded} />
}
