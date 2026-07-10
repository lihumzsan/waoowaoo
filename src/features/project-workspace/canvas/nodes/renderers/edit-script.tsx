import { EditScriptContent } from '../WorkspaceNodeRenderers'
import type { WorkspaceCanvasNodeRendererProps } from './types'

export function EditScriptNodeRenderer({ data, labels, expanded }: WorkspaceCanvasNodeRendererProps) {
  return <EditScriptContent data={data} labels={labels} expanded={expanded} />
}
