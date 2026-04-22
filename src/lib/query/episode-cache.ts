import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { queryKeys } from './keys'

export type EpisodeQuerySnapshot = Array<[QueryKey, unknown]>

function getEpisodeQueryPrefix(projectId: string, episodeId: string) {
  return queryKeys.episodeDataPrefix(projectId, episodeId)
}

export async function cancelEpisodeQueries(
  queryClient: QueryClient,
  projectId: string,
  episodeId: string,
) {
  await queryClient.cancelQueries({
    queryKey: getEpisodeQueryPrefix(projectId, episodeId),
    exact: false,
  })
}

export async function invalidateEpisodeQueries(
  queryClient: QueryClient,
  projectId: string,
  episodeId: string,
) {
  await queryClient.invalidateQueries({
    queryKey: getEpisodeQueryPrefix(projectId, episodeId),
    exact: false,
  })
}

export async function refetchEpisodeQueries(
  queryClient: QueryClient,
  projectId: string,
  episodeId: string,
) {
  await queryClient.refetchQueries({
    queryKey: getEpisodeQueryPrefix(projectId, episodeId),
    exact: false,
  })
}

export function getEpisodeQueriesSnapshot(
  queryClient: QueryClient,
  projectId: string,
  episodeId: string,
): EpisodeQuerySnapshot {
  return queryClient.getQueriesData({
    queryKey: getEpisodeQueryPrefix(projectId, episodeId),
    exact: false,
  })
}

export function restoreEpisodeQueriesSnapshot(
  queryClient: QueryClient,
  snapshot: EpisodeQuerySnapshot | null | undefined,
) {
  if (!snapshot) return
  for (const [queryKey, data] of snapshot) {
    queryClient.setQueryData(queryKey, data)
  }
}

export function setEpisodeQueriesData(
  queryClient: QueryClient,
  projectId: string,
  episodeId: string,
  updater: (previous: unknown) => unknown,
) {
  queryClient.setQueriesData(
    {
      queryKey: getEpisodeQueryPrefix(projectId, episodeId),
      exact: false,
    },
    updater,
  )
}
