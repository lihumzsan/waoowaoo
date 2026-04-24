import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Project } from '@/types/project'
import { resolveTaskResponse } from '@/lib/task/client'
import { queryKeys } from '../keys'
import {
  cancelEpisodeQueries,
  getEpisodeQueriesSnapshot,
  invalidateEpisodeQueries,
  restoreEpisodeQueriesSnapshot,
  setEpisodeQueriesData,
} from '../episode-cache'
import {
  invalidateQueryTemplates,
  requestBlobWithError,
  requestJsonWithError,
  requestTaskResponseWithError,
} from './mutation-shared'

/**
 * 获取项目剧集列表
 */
export function useListProjectEpisodes(projectId: string) {
  return useMutation({
    mutationFn: async () =>
      await requestJsonWithError<{
        episodes?: Array<{
          episodeNumber?: number
          name?: string
          description?: string
          novelText?: string
        }>
      }>(`/api/novel-promotion/${projectId}/episodes`, { method: 'GET' }, '获取剧集失败'),
  })
}

/**
 * AI 智能分割剧集
 */
export function useSplitProjectEpisodes(projectId: string) {
  return useMutation({
    mutationFn: async (payload: { content: string; async?: boolean }) => {
      const response = await requestTaskResponseWithError(
        `/api/novel-promotion/${projectId}/episodes/split`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        '分割失败',
      )
      return resolveTaskResponse<{
        episodes: Array<{
          number: number
          title: string
          summary: string
          content: string
          wordCount: number
        }>
      }>(response)
    },
  })
}

/**
 * 使用章节标记分割剧集
 */
export function useSplitProjectEpisodesByMarkers(projectId: string) {
  return useMutation({
    mutationFn: async (payload: { content: string }) =>
      await requestJsonWithError<{
        episodes?: Array<{
          number: number
          title: string
          summary: string
          content: string
          wordCount: number
        }>
      }>(
        `/api/novel-promotion/${projectId}/episodes/split-by-markers`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        '分割失败',
      ),
  })
}

/**
 * 批量保存项目剧集
 */
export function useSaveProjectEpisodesBatch(projectId: string) {
  return useMutation({
    mutationFn: async (payload: {
      episodes: Array<{
        name: string
        description?: string
        novelText?: string
      }>
      mode?: 'append' | 'update_current' | 'replace_all'
      episodeId?: string
      confirmReplace?: boolean
      /** @deprecated Use mode='replace_all' with confirmReplace=true instead. */
      clearExisting?: boolean
      importStatus?: 'pending' | 'completed'
      triggerGlobalAnalysis?: boolean
    }) =>
      await requestJsonWithError(
        `/api/novel-promotion/${projectId}/episodes/batch`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        '保存剧集失败',
      ),
  })
}

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
        `/api/novel-promotion/${projectId}/episodes/${episodeId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [key]: value }),
        },
        'Failed to update episode',
      ),
    onMutate: async (variables) => {
      const projectQueryKey = queryKeys.projectData(projectId)

      await cancelEpisodeQueries(queryClient, projectId, variables.episodeId)
      await queryClient.cancelQueries({ queryKey: projectQueryKey })

      const previousEpisodes = getEpisodeQueriesSnapshot(queryClient, projectId, variables.episodeId)
      const previousProject = queryClient.getQueryData<Project>(projectQueryKey)

      setEpisodeQueriesData(queryClient, projectId, variables.episodeId, (prev) => {
        if (!prev) return prev
        return {
          ...prev,
          [variables.key]: variables.value,
        }
      })

      queryClient.setQueryData<Project | undefined>(projectQueryKey, (prev) => {
        if (!prev?.novelPromotionData) return prev
        const episodes = Array.isArray(prev.novelPromotionData.episodes)
          ? prev.novelPromotionData.episodes.map((episode) =>
              episode.id === variables.episodeId ? { ...episode, [variables.key]: variables.value } : episode,
            )
          : prev.novelPromotionData.episodes
        return {
          ...prev,
          novelPromotionData: {
            ...prev.novelPromotionData,
            episodes,
          },
        }
      })

      return { previousEpisodes, previousProject, episodeId: variables.episodeId }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousEpisodes) {
        restoreEpisodeQueriesSnapshot(queryClient, context.previousEpisodes)
      }
      if (context?.previousProject) {
        queryClient.setQueryData(queryKeys.projectData(projectId), context.previousProject)
      }
    },
    onSettled: async (_, __, variables) => {
      await Promise.all([
        invalidateEpisodeQueries(queryClient, projectId, variables.episodeId),
        invalidateQueryTemplates(queryClient, [
          queryKeys.projectData(projectId),
        ]),
      ])
    },
  })
}

/**
 * 更新 clip 数据
 */
export function useUpdateProjectClip(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      clipId,
      data,
    }: {
      clipId: string
      data: Record<string, unknown>
      episodeId?: string
    }) =>
      await requestJsonWithError(
        `/api/novel-promotion/${projectId}/clips/${clipId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'update failed',
      ),
    onMutate: async (variables) => {
      if (!variables.episodeId) return { previousEpisodes: null, episodeId: null }

      await cancelEpisodeQueries(queryClient, projectId, variables.episodeId)

      const previousEpisodes = getEpisodeQueriesSnapshot(queryClient, projectId, variables.episodeId)
      setEpisodeQueriesData(queryClient, projectId, variables.episodeId, (prev) => {
        if (!prev || typeof prev !== 'object') return prev
        const episode = prev as Record<string, unknown>
        const clips = Array.isArray(episode.clips) ? episode.clips : []
        return {
          ...episode,
          clips: clips.map((clip: Record<string, unknown>) =>
            clip?.id === variables.clipId ? { ...clip, ...variables.data } : clip,
          ),
        }
      })

      return { previousEpisodes, episodeId: variables.episodeId }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousEpisodes) {
        restoreEpisodeQueriesSnapshot(queryClient, context.previousEpisodes)
      }
    },
    onSettled: async (_data, _error, variables) => {
      await invalidateQueryTemplates(queryClient, [queryKeys.projectData(projectId)])
      if (variables.episodeId) {
        await invalidateEpisodeQueries(queryClient, projectId, variables.episodeId)
      }
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
        '下载失败',
      ),
  })
}
