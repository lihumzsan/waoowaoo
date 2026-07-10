import { FinalContent } from '../WorkspaceNodeRenderers'
import type { WorkspaceCanvasNodeRendererProps } from './types'

export function FinalTimelineNodeRenderer({ data, labels, expanded }: WorkspaceCanvasNodeRendererProps) {
  return <FinalContent data={data} labels={labels} expanded={expanded} />
}
