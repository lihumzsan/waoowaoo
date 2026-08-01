import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Project } from '@/types/project'
import { queryKeys } from '../keys'
import {
  invalidateQueryTemplates,
  requestBlobWithError,
  requestJsonWithError,
} from './mutation-shared'

/**
 * 更新剧集字段
 */
export function useUpdateProjectEpisodeField(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      episodeId,
      key,
      value,
    }: {
      episodeId: string
      key: string
      value: unknown
    }) =>
      await requestJsonWithError(
        `/api/projects/${projectId}/episodes/${episodeId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [key]: value }),
        },
      ),
    onMutate: async (variables) => {
      const episodeQueryKey = queryKeys.episodeData(projectId, variables.episodeId)
      const projectQueryKey = queryKeys.projectData(projectId)

      await queryClient.cancelQueries({ queryKey: episodeQueryKey })
      await queryClient.cancelQueries({ queryKey: projectQueryKey })

      const previousEpisode = queryClient.getQueryData<Record<string, unknown>>(episodeQueryKey)
      const previousProject = queryClient.getQueryData<Project>(projectQueryKey)

      queryClient.setQueryData<Record<string, unknown> | undefined>(episodeQueryKey, (prev) => {
        if (!prev) return prev
        return {
          ...prev,
          [variables.key]: variables.value,
        }
      })

      queryClient.setQueryData<Project | undefined>(projectQueryKey, (prev) => {
        if (!prev) return prev
        const episodes = Array.isArray(prev.episodes)
          ? prev.episodes.map((episode) =>
              episode.id === variables.episodeId ? { ...episode, [variables.key]: variables.value } : episode,
            )
          : prev.episodes
        return {
          ...prev,
          episodes,
        }
      })

      return { previousEpisode, previousProject, episodeId: variables.episodeId }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousEpisode && context.episodeId) {
        queryClient.setQueryData(
          queryKeys.episodeData(projectId, context.episodeId),
          context.previousEpisode,
        )
      }
      if (context?.previousProject) {
        queryClient.setQueryData(queryKeys.projectData(projectId), context.previousProject)
      }
    },
    onSettled: (_, __, variables) => {
      invalidateQueryTemplates(queryClient, [
        queryKeys.episodeData(projectId, variables.episodeId),
        queryKeys.projectData(projectId),
      ])
    },
  })
}

/**
 * 下载远程文件 blob（避免组件层直接 fetch）
 */
export function useDownloadRemoteBlob() {
  return useMutation({
    mutationFn: async (url: string) =>
      await requestBlobWithError(
        url,
        { method: 'GET' },
      ),
  })
}
