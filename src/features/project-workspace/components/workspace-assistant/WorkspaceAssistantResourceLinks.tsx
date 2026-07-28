'use client'

import type { DataMessagePartProps } from '@assistant-ui/react'
import type { CreativeResourceLinkView } from '@/lib/creative-resource/contracts'
import type { ProjectAgentResourceLinksPartData } from '@/lib/project-agent/types'

export function WorkspaceAssistantResourceLinks(
  props: DataMessagePartProps<ProjectAgentResourceLinksPartData>,
) {
  if (props.data.resources.length === 0) return null
  return (
    <div
      className="flex min-w-0 flex-col items-start gap-1"
      data-testid="workspace-assistant-resource-links"
    >
      {props.data.resources.map((resource: CreativeResourceLinkView) => (
        resource.href ? (
          <a
            key={resource.resourceId}
            href={resource.href}
            target="_blank"
            rel="noopener noreferrer"
            className="max-w-full break-words text-blue-600 underline-offset-4 hover:text-blue-700 hover:underline [overflow-wrap:anywhere]"
          >
            {resource.fileName}
          </a>
        ) : (
          <span
            key={resource.resourceId}
            className="max-w-full break-words text-[var(--glass-text-secondary)] [overflow-wrap:anywhere]"
          >
            {resource.fileName}
          </span>
        )
      ))}
    </div>
  )
}
