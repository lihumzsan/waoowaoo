'use client'

import { queryOptions, useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import { readProjectBibleJsonError } from '@/lib/query/project-bible-error'
import type { ProjectEditBible, ProjectEditChapter } from '@/types/project'
import { queryKeys } from '../keys'

export interface EditBibleResponse {
  editBible: ProjectEditBible | null
  chapters: ProjectEditChapter[]
}

async function fetchProjectEditBibleResponse(
  projectId: string,
  episodeId: string,
): Promise<EditBibleResponse> {
  const search = new URLSearchParams({ episodeId })
  const response = await apiFetch(`/api/projects/${projectId}/bible?${search.toString()}`)
  if (!response.ok) {
    throw await readProjectBibleJsonError(response, 'Failed to load episode planning context')
  }
  const data = await response.json() as {
    editBible: ProjectEditBible | null
    chapters?: ProjectEditChapter[]
  }
  const chapters = data.chapters ?? []
  return {
    editBible: data.editBible ? { ...data.editBible, chapters } : null,
    chapters,
  }
}

export function projectEditBibleQueryOptions(projectId: string, episodeId: string) {
  return queryOptions({
    queryKey: queryKeys.project.editBible(projectId, episodeId),
    queryFn: async (): Promise<EditBibleResponse> => {
      if (!projectId || !episodeId) throw new Error('Project ID and episode ID are required')
      return await fetchProjectEditBibleResponse(projectId, episodeId)
    },
    staleTime: 5_000,
  })
}

export function useProjectEditBible(projectId: string | null, episodeId: string | null) {
  return useQuery({
    ...projectEditBibleQueryOptions(projectId || '', episodeId || ''),
    select: (data) => data.editBible,
    enabled: Boolean(projectId && episodeId),
  })
}

export function useProjectEditBibleResponse(projectId: string | null, episodeId: string | null) {
  return useQuery({
    ...projectEditBibleQueryOptions(projectId || '', episodeId || ''),
    enabled: Boolean(projectId && episodeId),
  })
}
