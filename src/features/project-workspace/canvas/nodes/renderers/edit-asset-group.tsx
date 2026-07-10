import { EditAssetGroupContent } from '../WorkspaceNodeRenderers'
import type { WorkspaceCanvasNodeRendererProps } from './types'

export function EditAssetGroupNodeRenderer({ data, labels }: WorkspaceCanvasNodeRendererProps) {
  return <EditAssetGroupContent data={data} labels={labels} />
}
