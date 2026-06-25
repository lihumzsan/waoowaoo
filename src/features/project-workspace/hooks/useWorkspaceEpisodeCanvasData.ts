'use client'

import { useEpisodeData } from '@/lib/query/hooks'
import type { ProjectEditScript, ProjectFinalVideo, ProjectStoryboard, ProjectVideoGroup } from '@/types/project'
import { useWorkspaceProvider } from '../WorkspaceProvider'

interface EpisodeCanvasPayload {
  name?: string
  novelText?: string | null
  audioUrl?: string | null
  srtContent?: string | null
  storyboards?: ProjectStoryboard[]
  editScript?: ProjectEditScript | null
  finalVideo?: ProjectFinalVideo | null
  videoGroups?: ProjectVideoGroup[]
}

export function useWorkspaceEpisodeCanvasData() {
  const { projectId, episodeId } = useWorkspaceProvider()
  const { data: episodeData } = useEpisodeData(projectId, episodeId || null)
  const payload = episodeData as EpisodeCanvasPayload | null

  return {
    episodeName: payload?.name,
    novelText: payload?.novelText || '',
    audioUrl: payload?.audioUrl || null,
    srtContent: payload?.srtContent || null,
    storyboards: payload?.storyboards || [],
    editScript: payload?.editScript || null,
    finalVideo: payload?.finalVideo || null,
    videoGroups: payload?.videoGroups || [],
  }
}
