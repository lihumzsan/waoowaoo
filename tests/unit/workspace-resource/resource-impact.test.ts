import { describe, expect, it } from 'vitest'
import {
  requireWorkspaceResourceRefs,
  resolveWorkspaceResourceRefs,
  WORKSPACE_RESOURCE_IMPACT,
  WORKSPACE_RESOURCE_KIND,
} from '@/lib/workspace-resource/resource-impact'

describe('resource-impact', () => {
  it('invalidates the Resource spine and its episode projections as one declared impact', () => {
    expect(resolveWorkspaceResourceRefs({
      impact: WORKSPACE_RESOURCE_IMPACT.CREATIVE_RESOURCES,
      projectId: 'project-1',
      episodeId: 'episode-1',
    })).toEqual([
      { kind: WORKSPACE_RESOURCE_KIND.CREATIVE_RESOURCES, projectId: 'project-1', episodeId: 'episode-1' },
      { kind: WORKSPACE_RESOURCE_KIND.STORY_CANON, projectId: 'project-1', episodeId: 'episode-1' },
      { kind: WORKSPACE_RESOURCE_KIND.EPISODE_DATA, projectId: 'project-1', episodeId: 'episode-1' },
      { kind: WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT, projectId: 'project-1', episodeId: 'episode-1' },
      { kind: WORKSPACE_RESOURCE_KIND.PROJECT_DATA, projectId: 'project-1' },
    ])
  })

  it('supports project and global scopes without inventing an episode', () => {
    expect(resolveWorkspaceResourceRefs({
      impact: WORKSPACE_RESOURCE_IMPACT.PROJECT_ASSETS,
      projectId: 'project-1',
      episodeId: null,
    })).toEqual([
      { kind: WORKSPACE_RESOURCE_KIND.PROJECT_ASSETS, projectId: 'project-1', episodeId: null },
      { kind: WORKSPACE_RESOURCE_KIND.PROJECT_DATA, projectId: 'project-1' },
    ])
    expect(resolveWorkspaceResourceRefs({
      impact: WORKSPACE_RESOURCE_IMPACT.GLOBAL_ASSETS,
      projectId: 'global-asset-hub',
      episodeId: null,
    })).toEqual([
      { kind: WORKSPACE_RESOURCE_KIND.GLOBAL_ASSETS, projectId: 'global-asset-hub' },
    ])
    expect(resolveWorkspaceResourceRefs({
      impact: WORKSPACE_RESOURCE_IMPACT.NONE,
      projectId: 'project-1',
      episodeId: null,
    })).toEqual([])
  })

  it('fails closed when the explicitly episode-scoped impact has no episode identity', () => {
    expect(() => resolveWorkspaceResourceRefs({
      impact: WORKSPACE_RESOURCE_IMPACT.EPISODE,
      projectId: 'project-1',
      episodeId: null,
    })).toThrow('WORKSPACE_RESOURCE_IMPACT_EPISODE_REQUIRED:episode')
  })

  it('rejects malformed or duplicate explicit wire refs', () => {
    expect(() => requireWorkspaceResourceRefs([
      { kind: WORKSPACE_RESOURCE_KIND.STORY_CANON, projectId: 'project-1', episodeId: 1 },
    ])).toThrow('WORKSPACE_RESOURCE_REFS_INVALID')
    expect(() => requireWorkspaceResourceRefs([
      { kind: WORKSPACE_RESOURCE_KIND.PROJECT_DATA, projectId: 'project-1' },
      { kind: WORKSPACE_RESOURCE_KIND.PROJECT_DATA, projectId: 'project-1' },
    ])).toThrow('WORKSPACE_RESOURCE_REFS_INVALID')
  })
})
