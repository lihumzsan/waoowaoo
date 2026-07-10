import { SourceScriptContent } from '../WorkspaceNodeRenderers'
import type { WorkspaceCanvasNodeRendererProps } from './types'

export function EditSourceScriptNodeRenderer({ data, labels, expanded }: WorkspaceCanvasNodeRendererProps) {
  return <SourceScriptContent data={data} labels={labels} expanded={expanded} />
}
