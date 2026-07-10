import { VideoContent } from '../WorkspaceNodeRenderers'
import type { WorkspaceCanvasNodeRendererProps } from './types'

export function VideoClipNodeRenderer({ data, labels, expanded }: WorkspaceCanvasNodeRendererProps) {
  return <VideoContent data={data} labels={labels} expanded={expanded} />
}
