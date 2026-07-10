import { ShotContent } from '../WorkspaceNodeRenderers'
import type { WorkspaceCanvasNodeRendererProps } from './types'

export function ShotNodeRenderer({ data, labels }: WorkspaceCanvasNodeRendererProps) {
  return <ShotContent data={data} labels={labels} />
}
