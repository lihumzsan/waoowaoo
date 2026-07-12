import type { Project } from '@/types/project'
import type { ProjectStoryboard } from '@/types/project'
import type { ProjectAssistantTextAttachment } from '@/lib/project-agent/text-attachments'

export interface Episode {
  id: string
  episodeNumber: number
  name: string
  description?: string | null
  novelText?: string | null
  audioUrl?: string | null
  srtContent?: string | null
  storyboards?: ProjectStoryboard[]
  createdAt: string
}

export interface ProjectWorkspaceProps {
  project: Project
  projectId: string
  episodeId?: string
  episode?: Episode | null
  viewMode?: 'global-assets' | 'episode'
  episodes?: Episode[]
  assistantAutoStartDraft?: {
    readonly message: string
    readonly attachments: readonly ProjectAssistantTextAttachment[]
  } | null
  assistantAutoStartKey?: string | null
  onAssistantAutoStartConsumed?: () => void
  onEpisodeSelect?: (episodeId: string) => void
  onEpisodeCreate?: () => void
  onEpisodeRename?: (episodeId: string, newName: string) => void
  onEpisodeDelete?: (episodeId: string) => void
  onProjectRename?: (newName: string) => void | Promise<void>
}
