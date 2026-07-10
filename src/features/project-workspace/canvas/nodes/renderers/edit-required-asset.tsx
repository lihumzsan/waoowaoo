import { EditAssetContent } from '../WorkspaceNodeRenderers'
import type { WorkspaceCanvasNodeRendererProps } from './types'

export function EditRequiredAssetNodeRenderer({ data, labels, expanded }: WorkspaceCanvasNodeRendererProps) {
  return <EditAssetContent data={data} labels={labels} expanded={expanded} />
}
