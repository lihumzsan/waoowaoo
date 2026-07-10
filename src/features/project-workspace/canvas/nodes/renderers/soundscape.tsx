import { SoundscapeContent } from '../WorkspaceNodeRenderers'
import type { WorkspaceCanvasNodeRendererProps } from './types'

export function SoundscapeNodeRenderer({ data, labels, expanded }: WorkspaceCanvasNodeRendererProps) {
  return <SoundscapeContent data={data} labels={labels} expanded={expanded} />
}
