import { BgmScoreContent } from '../WorkspaceNodeRenderers'
import type { WorkspaceCanvasNodeRendererProps } from './types'

export function BgmScoreNodeRenderer({ data, labels, expanded }: WorkspaceCanvasNodeRendererProps) {
  return <BgmScoreContent data={data} labels={labels} expanded={expanded} />
}
