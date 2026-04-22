import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import {
  getEpisodeQueriesSnapshot,
  invalidateEpisodeQueries,
  restoreEpisodeQueriesSnapshot,
  setEpisodeQueriesData,
} from '@/lib/query/episode-cache'

describe('episode cache helpers', () => {
  it('uses distinct keys per profile', () => {
    expect(queryKeys.episodeData('project-1', 'episode-1', 'full')).not.toEqual(
      queryKeys.episodeData('project-1', 'episode-1', 'config'),
    )
    expect(queryKeys.episodeData('project-1', 'episode-1', 'config')).not.toEqual(
      queryKeys.episodeData('project-1', 'episode-1', 'workspace-visual'),
    )
  })

  it('updates all cached profiles for the same episode', () => {
    const queryClient = new QueryClient()
    const fullKey = queryKeys.episodeData('project-1', 'episode-1', 'full')
    const configKey = queryKeys.episodeData('project-1', 'episode-1', 'config')
    const otherKey = queryKeys.episodeData('project-1', 'episode-2', 'full')

    queryClient.setQueryData(fullKey, { name: 'Episode 1', clips: [] })
    queryClient.setQueryData(configKey, { name: 'Episode 1' })
    queryClient.setQueryData(otherKey, { name: 'Episode 2' })

    setEpisodeQueriesData(queryClient, 'project-1', 'episode-1', (previous) => {
      if (!previous || typeof previous !== 'object') return previous
      return {
        ...(previous as Record<string, unknown>),
        marker: 'updated',
      }
    })

    expect(queryClient.getQueryData(fullKey)).toMatchObject({ marker: 'updated' })
    expect(queryClient.getQueryData(configKey)).toMatchObject({ marker: 'updated' })
    expect(queryClient.getQueryData(otherKey)).toEqual({ name: 'Episode 2' })
  })

  it('can snapshot, invalidate, and restore all cached profiles', async () => {
    const queryClient = new QueryClient()
    const fullKey = queryKeys.episodeData('project-1', 'episode-1', 'full')
    const configKey = queryKeys.episodeData('project-1', 'episode-1', 'config')

    queryClient.setQueryData(fullKey, { name: 'Episode 1', version: 1 })
    queryClient.setQueryData(configKey, { name: 'Episode 1', version: 1 })

    const snapshot = getEpisodeQueriesSnapshot(queryClient, 'project-1', 'episode-1')

    setEpisodeQueriesData(queryClient, 'project-1', 'episode-1', (previous) => {
      if (!previous || typeof previous !== 'object') return previous
      return {
        ...(previous as Record<string, unknown>),
        version: 2,
      }
    })

    await invalidateEpisodeQueries(queryClient, 'project-1', 'episode-1')

    expect(queryClient.getQueryState(fullKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(configKey)?.isInvalidated).toBe(true)

    restoreEpisodeQueriesSnapshot(queryClient, snapshot)

    expect(queryClient.getQueryData(fullKey)).toMatchObject({ version: 1 })
    expect(queryClient.getQueryData(configKey)).toMatchObject({ version: 1 })
  })
})
