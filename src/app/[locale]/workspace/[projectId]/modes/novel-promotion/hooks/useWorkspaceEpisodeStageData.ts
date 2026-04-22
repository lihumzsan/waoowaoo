'use client'

import { useEpisodeData } from '@/lib/query/hooks'
import type { EpisodeDataProfile } from '@/lib/novel-promotion/episode-data-profile'
import type { NovelPromotionClip, NovelPromotionStoryboard } from '@/types/project'
import { useWorkspaceProvider } from '../WorkspaceProvider'

interface EpisodeStagePayload {
  name?: string
  novelText?: string | null
  clips?: NovelPromotionClip[]
  storyboards?: NovelPromotionStoryboard[]
}

export function useWorkspaceEpisodeStageData(profile: EpisodeDataProfile) {
  const { projectId, episodeId } = useWorkspaceProvider()
  const { data: episodeData } = useEpisodeData(projectId, episodeId || null, { profile })
  const payload = episodeData as EpisodeStagePayload | null

  return {
    episodeName: payload?.name,
    novelText: payload?.novelText || '',
    clips: payload?.clips || [],
    storyboards: payload?.storyboards || [],
  }
}
