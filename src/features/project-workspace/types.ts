import type { Project } from '@/types/project'
import type { ProjectAssistantTextAttachment } from '@/lib/project-agent/text-attachments'
import type { ProjectAssistantMediaAttachment } from '@/lib/project-agent/media-attachments'

export interface ProjectWorkspaceProps {
  readonly project: Project
  readonly projectId: string
  readonly assistantAutoStartDraft?: {
    readonly message: string
    readonly attachments: readonly ProjectAssistantTextAttachment[]
    readonly mediaAttachments: readonly ProjectAssistantMediaAttachment[]
  } | null
  readonly assistantAutoStartKey?: string | null
  readonly onAssistantAutoStartConsumed?: () => void
}
