import { describe, expect, it } from 'vitest'
import { TASK_EVENT_TYPE, TASK_TYPE } from '@/lib/task/types'
import {
  extractWorkspaceResourceRefsFromTaskLifecycleEvent,
  WORKSPACE_RESOURCE_KIND,
} from '@/lib/workspace-resource/resource-impact'

function kindsForTask(input: {
  taskType: string | null
  targetType: string | null
  episodeId?: string | null
}) {
  return extractWorkspaceResourceRefsFromTaskLifecycleEvent({
    taskType: input.taskType,
    lifecycleType: TASK_EVENT_TYPE.COMPLETED,
    projectId: 'project-1',
    targetType: input.targetType,
    targetId: 'target-1',
    episodeId: input.episodeId ?? 'episode-1',
    payload: null,
  }).map((ref) => ref.kind)
}

describe('resource-impact', () => {
  it('declares edit pipeline resources for edit generation tasks', () => {
    expect(kindsForTask({
      taskType: TASK_TYPE.EDIT_SCRIPT_GENERATE,
      targetType: 'ProjectEditScript',
    })).toEqual([
      WORKSPACE_RESOURCE_KIND.EDIT_SCREENPLAY,
      WORKSPACE_RESOURCE_KIND.EDIT_DIRECTOR_DECOUPAGE,
      WORKSPACE_RESOURCE_KIND.EDIT_SCRIPT,
      WORKSPACE_RESOURCE_KIND.EDIT_CINEMATOGRAPHY_SHOT_PLAN,
      WORKSPACE_RESOURCE_KIND.STORYBOARDS,
      WORKSPACE_RESOURCE_KIND.EPISODE_DATA,
      WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT,
      WORKSPACE_RESOURCE_KIND.PROJECT_DATA,
    ])
  })

  it('declares project asset resources for asset image tasks', () => {
    expect(kindsForTask({
      taskType: TASK_TYPE.IMAGE_CHARACTER,
      targetType: 'CharacterAppearance',
    })).toEqual([
      WORKSPACE_RESOURCE_KIND.PROJECT_ASSETS,
      WORKSPACE_RESOURCE_KIND.EDIT_SCRIPT,
      WORKSPACE_RESOURCE_KIND.EPISODE_DATA,
      WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT,
      WORKSPACE_RESOURCE_KIND.PROJECT_DATA,
    ])
  })

  it('declares storyboard resources for panel image tasks', () => {
    expect(kindsForTask({
      taskType: TASK_TYPE.IMAGE_PANEL,
      targetType: 'ProjectPanel',
    })).toEqual([
      WORKSPACE_RESOURCE_KIND.STORYBOARDS,
      WORKSPACE_RESOURCE_KIND.EDIT_SCRIPT,
      WORKSPACE_RESOURCE_KIND.EPISODE_DATA,
      WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT,
      WORKSPACE_RESOURCE_KIND.PROJECT_DATA,
    ])
  })

  it('declares media resources for panel video, group video, final render, and BGM score tasks', () => {
    for (const taskType of [
      TASK_TYPE.VIDEO_PANEL,
      TASK_TYPE.VIDEO_GROUP,
      TASK_TYPE.FINAL_VIDEO_RENDER,
      TASK_TYPE.BGM_SCORE_GENERATE,
    ]) {
      expect(kindsForTask({ taskType, targetType: 'ProjectVideoGroup' })).toEqual([
        WORKSPACE_RESOURCE_KIND.VIDEOS,
        WORKSPACE_RESOURCE_KIND.STORYBOARDS,
        WORKSPACE_RESOURCE_KIND.EPISODE_DATA,
        WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT,
        WORKSPACE_RESOURCE_KIND.PROJECT_DATA,
      ])
    }
  })

  it('declares style preview resources for style preview image tasks', () => {
    expect(kindsForTask({
      taskType: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
      targetType: 'ProjectEditStylePreview',
    })).toEqual([
      WORKSPACE_RESOURCE_KIND.EDIT_SCREENPLAY,
      WORKSPACE_RESOURCE_KIND.EPISODE_DATA,
      WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT,
      WORKSPACE_RESOURCE_KIND.PROJECT_DATA,
    ])
  })

  it('declares global asset resources for asset hub image tasks', () => {
    const refs = extractWorkspaceResourceRefsFromTaskLifecycleEvent({
      taskType: TASK_TYPE.ASSET_HUB_IMAGE,
      lifecycleType: TASK_EVENT_TYPE.COMPLETED,
      projectId: 'global-asset-hub',
      targetType: 'GlobalCharacterAppearance',
      targetId: 'appearance-1',
      episodeId: null,
      payload: null,
    })

    expect(refs).toEqual([
      { kind: WORKSPACE_RESOURCE_KIND.GLOBAL_ASSETS, projectId: 'global-asset-hub' },
      { kind: WORKSPACE_RESOURCE_KIND.PROJECT_DATA, projectId: 'global-asset-hub' },
    ])
  })

  it('does not declare resources for non-terminal lifecycle events', () => {
    expect(extractWorkspaceResourceRefsFromTaskLifecycleEvent({
      taskType: TASK_TYPE.IMAGE_PANEL,
      lifecycleType: TASK_EVENT_TYPE.PROCESSING,
      projectId: 'project-1',
      targetType: 'ProjectPanel',
      targetId: 'panel-1',
      episodeId: 'episode-1',
      payload: null,
    })).toEqual([])
  })
})
