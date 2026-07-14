import { describe, expect, it } from 'vitest'
import {
  requireWorkspaceResourceRefs,
  resolveWorkspaceResourceRefs,
  WORKSPACE_RESOURCE_IMPACT,
  WORKSPACE_RESOURCE_KIND,
} from '@/lib/workspace-resource/resource-impact'

function kindsForImpact(
  impact: Parameters<typeof resolveWorkspaceResourceRefs>[0]['impact'],
  episodeId: string | null = 'episode-1',
) {
  return resolveWorkspaceResourceRefs({
    impact,
    projectId: 'project-1',
    episodeId,
  }).map((ref) => ref.kind)
}

describe('resource-impact', () => {
  it('projects every declared episode resource domain without inspecting a Task, target, or output', () => {
    expect(kindsForImpact(WORKSPACE_RESOURCE_IMPACT.EDIT_PIPELINE)).toEqual([
      WORKSPACE_RESOURCE_KIND.EDIT_BIBLE,
      WORKSPACE_RESOURCE_KIND.EDIT_SCRIPT,
      WORKSPACE_RESOURCE_KIND.EDIT_SHOT_EXECUTION_PLAN,
      WORKSPACE_RESOURCE_KIND.EPISODE_DATA,
      WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT,
      WORKSPACE_RESOURCE_KIND.PROJECT_DATA,
    ])
    expect(kindsForImpact(WORKSPACE_RESOURCE_IMPACT.EDIT_STYLE_PREVIEW)).toEqual([
      WORKSPACE_RESOURCE_KIND.EDIT_BIBLE,
      WORKSPACE_RESOURCE_KIND.EPISODE_DATA,
      WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT,
      WORKSPACE_RESOURCE_KIND.PROJECT_DATA,
    ])
    expect(kindsForImpact(WORKSPACE_RESOURCE_IMPACT.VIDEO_SEGMENTS)).toEqual([
      WORKSPACE_RESOURCE_KIND.VIDEO_SEGMENTS,
      WORKSPACE_RESOURCE_KIND.EDIT_SCRIPT,
      WORKSPACE_RESOURCE_KIND.EDIT_SHOT_EXECUTION_PLAN,
      WORKSPACE_RESOURCE_KIND.EPISODE_DATA,
      WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT,
      WORKSPACE_RESOURCE_KIND.PROJECT_DATA,
    ])
    expect(kindsForImpact(WORKSPACE_RESOURCE_IMPACT.EPISODE)).toEqual([
      WORKSPACE_RESOURCE_KIND.EPISODE_DATA,
      WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT,
      WORKSPACE_RESOURCE_KIND.PROJECT_DATA,
    ])
  })

  it('supports project and global scope without inventing an episode identity', () => {
    expect(
      resolveWorkspaceResourceRefs({
        impact: WORKSPACE_RESOURCE_IMPACT.PROJECT_ASSETS,
        projectId: 'project-1',
        episodeId: null,
      }),
    ).toEqual([
      {
        kind: WORKSPACE_RESOURCE_KIND.PROJECT_ASSETS,
        projectId: 'project-1',
        episodeId: null,
      },
      { kind: WORKSPACE_RESOURCE_KIND.PROJECT_DATA, projectId: 'project-1' },
    ])
    expect(
      resolveWorkspaceResourceRefs({
        impact: WORKSPACE_RESOURCE_IMPACT.GLOBAL_ASSETS,
        projectId: 'global-asset-hub',
        episodeId: null,
      }),
    ).toEqual([
      {
        kind: WORKSPACE_RESOURCE_KIND.GLOBAL_ASSETS,
        projectId: 'global-asset-hub',
      },
    ])
    expect(
      resolveWorkspaceResourceRefs({
        impact: WORKSPACE_RESOURCE_IMPACT.NONE,
        projectId: 'project-1',
        episodeId: null,
      }),
    ).toEqual([])
  })

  it('fails closed when an episode-scoped declaration has no episode identity', () => {
    for (const impact of [
      WORKSPACE_RESOURCE_IMPACT.EDIT_PIPELINE,
      WORKSPACE_RESOURCE_IMPACT.EDIT_STYLE_PREVIEW,
      WORKSPACE_RESOURCE_IMPACT.VIDEO_SEGMENTS,
      WORKSPACE_RESOURCE_IMPACT.EPISODE,
    ]) {
      expect(() =>
        resolveWorkspaceResourceRefs({
          impact,
          projectId: 'project-1',
          episodeId: null,
        }),
      ).toThrow(`WORKSPACE_RESOURCE_IMPACT_EPISODE_REQUIRED:${impact}`)
    }
  })

  it('rejects malformed or duplicate explicit wire refs', () => {
    expect(() => requireWorkspaceResourceRefs([
      { kind: WORKSPACE_RESOURCE_KIND.EDIT_BIBLE, projectId: 'project-1', episodeId: 1 },
    ])).toThrow('WORKSPACE_RESOURCE_REFS_INVALID')
    expect(() => requireWorkspaceResourceRefs([
      { kind: WORKSPACE_RESOURCE_KIND.PROJECT_DATA, projectId: 'project-1' },
      { kind: WORKSPACE_RESOURCE_KIND.PROJECT_DATA, projectId: 'project-1' },
    ])).toThrow('WORKSPACE_RESOURCE_REFS_INVALID')
  })
})
