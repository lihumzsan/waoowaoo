'use client'

import type { WorkspaceCanvasNodeRendererProps } from './types'
import {
  ResourceMediaShell,
  type ResourceMediaShellItem,
} from './resource-media-shell'

const MAX_VISIBLE_CANDIDATES = 4

export function ResourceCardContent({ data, labels }: WorkspaceCanvasNodeRendererProps) {
  const details = data.resourceDetails
  if (!details) return null
  const summaryByResourceId = new Map(
    details.candidates?.summaries.map((entry) => [entry.resourceId, entry.summary]) ?? [],
  )
  const items: ResourceMediaShellItem[] = details.candidates?.resources.map((resource) => {
    const summary = summaryByResourceId.get(resource.resourceId)
    if (!summary) {
      throw new Error(`CREATIVE_RESOURCE_CANDIDATE_SUMMARY_MISSING:${resource.resourceId}`)
    }
    return { resource, summary }
  }) ?? [{
    resource: details.resource,
    summary: details.presentation.summary,
  }]
  const displayed = items.slice(0, MAX_VISIBLE_CANDIDATES)
  const moreCount = items.length - displayed.length
  return (
    <ResourceMediaShell
      shell={data.mediaShell}
      lifecycle={data.lifecycle}
      items={displayed}
      moreCount={moreCount}
      moreLabel={moreCount > 0 ? labels('moreItems', { count: moreCount }) : null}
    />
  )
}
