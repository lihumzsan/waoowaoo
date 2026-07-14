'use client'

import { useEpisodeData } from '@/lib/query/hooks'
import type {
  ProjectEditScript,
  ProjectEditShotExecutionPlan,
  ProjectFinalVideo,
  ProjectVideoSegment,
} from '@/types/project'
import { useWorkspaceProvider } from '../WorkspaceProvider'

interface EpisodeCanvasPayload {
  name?: string
  novelText?: string | null
  audioUrl?: string | null
  srtContent?: string | null
  editScript?: ProjectEditScript | null
  editScripts?: ProjectEditScript[]
  editShotExecutionPlans?: ProjectEditShotExecutionPlan[]
  finalVideo?: ProjectFinalVideo | null
  videoSegments?: ProjectVideoSegment[]
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
    editScript: payload?.editScript || null,
    editScripts: payload?.editScripts || [],
    editShotExecutionPlans: payload?.editShotExecutionPlans || [],
    finalVideo: payload?.finalVideo || null,
    videoSegments: payload?.videoSegments || [],
  }
}
