import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { invalidateByTarget } from '@/lib/query/invalidation/invalidate-by-target'
import { queryKeys } from '@/lib/query/keys'

type InvalidateArg = { queryKey?: readonly unknown[]; exact?: boolean }

function createQueryClient() {
  const queryClient = new QueryClient()
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
  return { queryClient, invalidateQueries }
}

function hasInvalidation(
  queryClient: ReturnType<typeof createQueryClient>,
  predicate: (arg: InvalidateArg) => boolean,
) {
  return queryClient.invalidateQueries.mock.calls.some((call) => {
    const arg = (call[0] || {}) as InvalidateArg
    return predicate(arg)
  })
}

describe('invalidateByTarget', () => {
  it('ProjectPanel invalidates episode scoped GUI queries', () => {
    const testClient = createQueryClient()

    invalidateByTarget({
      queryClient: testClient.queryClient,
      projectId: 'project-1',
      targetType: 'ProjectPanel',
      episodeId: 'episode-1',
    })

    expect(hasInvalidation(testClient, (arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.episodeData('project-1', 'episode-1')[0]
        && key[1] === 'project-1'
        && key[2] === 'episode-1'
    })).toBe(true)
    expect(hasInvalidation(testClient, (arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.storyboards.all('episode-1')[0]
        && key[1] === 'episode-1'
    })).toBe(true)
    expect(hasInvalidation(testClient, (arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.project.editScript('project-1', 'episode-1')[0]
        && key[1] === 'project-1'
        && key[2] === 'edit-script'
        && key[3] === 'episode-1'
    })).toBe(true)
    expect(hasInvalidation(testClient, (arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.project.editScreenplay('project-1', 'episode-1')[0]
        && key[1] === 'project-1'
        && key[2] === 'edit-screenplay'
        && key[3] === 'episode-1'
    })).toBe(true)
  })

  it('ProjectVideoGroup invalidates episode scoped GUI queries', () => {
    const testClient = createQueryClient()

    invalidateByTarget({
      queryClient: testClient.queryClient,
      projectId: 'project-1',
      targetType: 'ProjectVideoGroup',
      episodeId: 'episode-1',
    })

    expect(hasInvalidation(testClient, (arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.episodeData('project-1', 'episode-1')[0]
        && key[1] === 'project-1'
        && key[2] === 'episode-1'
    })).toBe(true)
    expect(hasInvalidation(testClient, (arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.storyboards.all('episode-1')[0]
        && key[1] === 'episode-1'
    })).toBe(true)
  })

  it('ProjectEditScript invalidates episode scoped storyboard queries after spatial blocking tasks complete', () => {
    const testClient = createQueryClient()

    invalidateByTarget({
      queryClient: testClient.queryClient,
      projectId: 'project-1',
      targetType: 'ProjectEditScript',
      episodeId: 'episode-1',
    })

    expect(hasInvalidation(testClient, (arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.episodeData('project-1', 'episode-1')[0]
        && key[1] === 'project-1'
        && key[2] === 'episode-1'
    })).toBe(true)
    expect(hasInvalidation(testClient, (arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.storyboards.all('episode-1')[0]
        && key[1] === 'episode-1'
    })).toBe(true)
    expect(hasInvalidation(testClient, (arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.project.editScript('project-1', 'episode-1')[0]
        && key[1] === 'project-1'
        && key[2] === 'edit-script'
        && key[3] === 'episode-1'
    })).toBe(true)
  })

  it('ProjectEditStylePreview invalidates edit screenplay after preview image tasks complete', () => {
    const testClient = createQueryClient()

    invalidateByTarget({
      queryClient: testClient.queryClient,
      projectId: 'project-1',
      targetType: 'ProjectEditStylePreview',
      episodeId: 'episode-1',
    })

    expect(hasInvalidation(testClient, (arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.project.editScreenplay('project-1', 'episode-1')[0]
        && key[1] === 'project-1'
        && key[2] === 'edit-screenplay'
        && key[3] === 'episode-1'
    })).toBe(true)
    expect(hasInvalidation(testClient, (arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.project.context('project-1', 'episode-1')[0]
        && key[1] === 'project-1'
        && key[2] === 'context'
        && key[3] === 'episode-1'
    })).toBe(true)
    expect(hasInvalidation(testClient, (arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.projectData('project-1')[0]
        && key[1] === 'project-1'
    })).toBe(true)
  })

  it('ProjectCharacter invalidates project asset queries', () => {
    const testClient = createQueryClient()

    invalidateByTarget({
      queryClient: testClient.queryClient,
      projectId: 'project-1',
      targetType: 'ProjectCharacter',
      episodeId: null,
    })

    expect(hasInvalidation(testClient, (arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.projectAssets.characters('project-1')[0]
        && key[1] === 'project-1'
        && key[2] === 'characters'
    })).toBe(true)
    expect(hasInvalidation(testClient, (arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.projectAssets.all('project-1')[0]
        && key[1] === 'project-1'
    })).toBe(true)
  })

  it('CharacterAppearance invalidates episode scoped edit script query', () => {
    const testClient = createQueryClient()

    invalidateByTarget({
      queryClient: testClient.queryClient,
      projectId: 'project-1',
      targetType: 'CharacterAppearance',
      episodeId: 'episode-1',
    })

    expect(hasInvalidation(testClient, (arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.project.editScript('project-1', 'episode-1')[0]
        && key[1] === 'project-1'
        && key[2] === 'edit-script'
        && key[3] === 'episode-1'
    })).toBe(true)
  })

  it('ProjectLocation invalidates unified project asset queries', () => {
    const testClient = createQueryClient()

    invalidateByTarget({
      queryClient: testClient.queryClient,
      projectId: 'project-1',
      targetType: 'ProjectLocation',
      episodeId: null,
    })

    expect(hasInvalidation(testClient, (arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.assets.all('project', 'project-1')[0]
        && key[1] === 'project-1'
        && key[2] === 'unified'
    })).toBe(true)
    expect(hasInvalidation(testClient, (arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.projectAssets.locations('project-1')[0]
        && key[1] === 'project-1'
        && key[2] === 'locations'
    })).toBe(true)
  })

  it('ProjectAsset invalidates all unified project asset queries', () => {
    const testClient = createQueryClient()

    invalidateByTarget({
      queryClient: testClient.queryClient,
      projectId: 'project-1',
      targetType: 'ProjectAsset',
      episodeId: null,
    })

    expect(hasInvalidation(testClient, (arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.assets.all('project', 'project-1')[0]
        && key[1] === 'project-1'
        && key[2] === 'unified'
    })).toBe(true)
    expect(hasInvalidation(testClient, (arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.projectAssets.all('project-1')[0]
        && key[1] === 'project-1'
    })).toBe(true)
  })
})
