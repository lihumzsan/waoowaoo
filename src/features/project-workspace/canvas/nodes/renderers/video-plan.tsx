import { VideoPlanContent } from '../WorkspaceNodeRenderers'
import type { WorkspaceCanvasNodeRendererProps } from './types'

export function VideoPlanNodeRenderer({ data, labels, expanded }: WorkspaceCanvasNodeRendererProps) {
  return <VideoPlanContent data={data} labels={labels} expanded={expanded} />
}
