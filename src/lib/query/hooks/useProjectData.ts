'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import { resolveTaskErrorMessage } from '@/lib/task/error-message'
import type {
  Project,
  MediaRef,
  NovelPromotionClip,
  NovelPromotionShot,
  NovelPromotionStoryboard,
} from '@/types/project'
import { apiFetch } from '@/lib/api-fetch'
import type { StageArtifactReadiness } from '@/lib/novel-promotion/stage-readiness'
import {
  EPISODE_DATA_PROFILE_DEFAULT,
  type EpisodeDataProfile,
  normalizeEpisodeDataProfile,
} from '@/lib/novel-promotion/episode-data-profile'
import { invalidateEpisodeQueries } from '../episode-cache'

interface ProjectDataResponse {
  project: Project
}

export function useProjectData(projectId: string | null) {
  return useQuery({
    queryKey: queryKeys.projectData(projectId || ''),
    queryFn: async () => {
      if (!projectId) throw new Error('Project ID is required')
      const res = await apiFetch(`/api/projects/${projectId}/data`)
      if (!res.ok) {
        const error = await res.json()
        throw new Error(resolveTaskErrorMessage(error, 'Failed to load project'))
      }
      const data: ProjectDataResponse = await res.json()
      return data.project
    },
    enabled: !!projectId,
    staleTime: 5000,
  })
}

export function useRefreshProjectData(projectId: string | null) {
  const queryClient = useQueryClient()

  return () => {
    if (projectId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
    }
  }
}

export interface Episode {
  id: string
  episodeNumber: number
  name: string
  description?: string | null
  novelText?: string | null
  audioUrl?: string | null
  media?: MediaRef | null
  srtContent?: string | null
  createdAt: string
  artifactReadiness?: StageArtifactReadiness
  clips?: NovelPromotionClip[]
  storyboards?: NovelPromotionStoryboard[]
  shots?: NovelPromotionShot[]
  voiceLines?: VoiceLine[]
  storyboardData?: StoryboardData
}

interface VoiceLine {
  id: string
  text: string
  speakerId: string
  audioUrl?: string | null
  media?: MediaRef | null
  lineTaskRunning?: boolean
}

interface StoryboardData {
  panels: unknown[]
}

interface EpisodeDataQueryOptions {
  enabled?: boolean
  profile?: EpisodeDataProfile
}

export function useEpisodeData(
  projectId: string | null,
  episodeId: string | null,
  options: EpisodeDataQueryOptions = {},
) {
  const profile = normalizeEpisodeDataProfile(options.profile)

  return useQuery({
    queryKey: queryKeys.episodeData(projectId || '', episodeId || '', profile),
    queryFn: async () => {
      if (!projectId || !episodeId) throw new Error('Project ID and Episode ID are required')
      const params = new URLSearchParams()
      if (profile !== EPISODE_DATA_PROFILE_DEFAULT) {
        params.set('profile', profile)
      }
      const suffix = params.toString()
      const res = await apiFetch(
        `/api/novel-promotion/${projectId}/episodes/${episodeId}${suffix ? `?${suffix}` : ''}`,
      )
      if (!res.ok) {
        const error = await res.json()
        throw new Error(resolveTaskErrorMessage(error, 'Failed to load episode'))
      }
      const data = await res.json()
      return data.episode as Episode
    },
    enabled: (options.enabled ?? true) && !!projectId && !!episodeId,
    staleTime: 5000,
  })
}

export function useEpisodes(projectId: string | null) {
  const { data: project } = useProjectData(projectId)

  const episodes = project?.novelPromotionData?.episodes || []
  return { episodes, isLoading: !project }
}

export function useRefreshEpisodeData(projectId: string | null, episodeId: string | null) {
  const queryClient = useQueryClient()

  return async () => {
    if (projectId && episodeId) {
      await invalidateEpisodeQueries(queryClient, projectId, episodeId)
    }
  }
}

export function useRefreshAll(projectId: string | null, episodeId: string | null) {
  const queryClient = useQueryClient()

  return async () => {
    if (projectId) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectAssets.all(projectId) }),
      ])
    }
    if (projectId && episodeId) {
      await Promise.all([
        invalidateEpisodeQueries(queryClient, projectId, episodeId),
        queryClient.invalidateQueries({
          queryKey: queryKeys.storyboards.all(episodeId),
        }),
      ])
    }
  }
}
