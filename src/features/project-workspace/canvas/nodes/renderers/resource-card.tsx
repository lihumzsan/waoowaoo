'use client'

import type { WorkspaceCanvasNodeRendererProps } from './types'
import {
  ResourceMediaShell,
  type ResourceMediaShellItem,
} from './resource-media-shell'

export function ResourceCardContent({ data }: WorkspaceCanvasNodeRendererProps) {
  const details = data.resourceDetails
  if (!details) return null
  const items: ResourceMediaShellItem[] = [{
    resource: details.resource,
    summary: details.presentation.summary,
  }]
  return (
    <ResourceMediaShell
      shell={data.mediaShell}
      lifecycle={data.lifecycle}
      items={items}
      moreCount={0}
      moreLabel={null}
    />
  )
}
