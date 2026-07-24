'use client'

import { queryOptions, useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import { readProjectStoryCanonJsonError } from '@/lib/query/project-story-canon-error'
import type { ProjectStoryCanon, ProjectEditChapter } from '@/types/project'
import { queryKeys } from '../keys'

export interface StoryCanonResponse {
  storyCanon: ProjectStoryCanon | null
  chapters: ProjectEditChapter[]
}

async function fetchProjectStoryCanonResponse(
  projectId: string,
  episodeId: string,
): Promise<StoryCanonResponse> {
  const search = new URLSearchParams({ episodeId })
  const response = await apiFetch(`/api/projects/${projectId}/story-canon?${search.toString()}`)
  if (!response.ok) {
    throw await readProjectStoryCanonJsonError(response, 'Failed to load episode planning context')
  }
  const data = await response.json() as {
    storyCanon: ProjectStoryCanon | null
    chapters?: ProjectEditChapter[]
  }
  const chapters = data.chapters ?? []
  return {
    storyCanon: data.storyCanon ? { ...data.storyCanon, chapters } : null,
    chapters,
  }
}

export function projectStoryCanonQueryOptions(projectId: string, episodeId: string) {
  return queryOptions({
    queryKey: queryKeys.project.storyCanon(projectId, episodeId),
    queryFn: async (): Promise<StoryCanonResponse> => {
      if (!projectId || !episodeId) throw new Error('Project ID and episode ID are required')
      return await fetchProjectStoryCanonResponse(projectId, episodeId)
    },
    staleTime: 5_000,
  })
}

export function useProjectStoryCanon(projectId: string | null, episodeId: string | null) {
  return useQuery({
    ...projectStoryCanonQueryOptions(projectId || '', episodeId || ''),
    select: (data) => data.storyCanon,
    enabled: Boolean(projectId && episodeId),
  })
}

export function useProjectStoryCanonResponse(projectId: string | null, episodeId: string | null) {
  return useQuery({
    ...projectStoryCanonQueryOptions(projectId || '', episodeId || ''),
    enabled: Boolean(projectId && episodeId),
  })
}
