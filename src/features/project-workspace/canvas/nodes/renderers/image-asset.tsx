import { ImageContent } from '../WorkspaceNodeRenderers'
import type { WorkspaceCanvasNodeRendererProps } from './types'

export function ImageAssetNodeRenderer({ data, labels, expanded }: WorkspaceCanvasNodeRendererProps) {
  return <ImageContent data={data} labels={labels} expanded={expanded} />
}
