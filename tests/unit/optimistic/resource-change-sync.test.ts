import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import {
  extractWorkspaceResourceChangesFromWriteResult,
  syncWorkspaceResourceChanges,
  syncWorkspaceResourceChangesFromWriteResult,
  WORKSPACE_RESOURCE_KIND,
} from '@/lib/query/resource-change-sync'
import { queryKeys } from '@/lib/query/keys'
import type { ProjectEditScreenplay, ProjectEditScript } from '@/types/project'
import { TASK_EVENT_TYPE, TASK_TYPE } from '@/lib/task/types'
import { extractWorkspaceResourceRefsFromTaskLifecycleEvent } from '@/lib/workspace-resource/resource-impact'

function createScreenplay(): ProjectEditScreenplay {
  return {
    id: 'screenplay-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    userPrompt: 'make a quiet short film',
    screenplayText: '标题：《静水》',
    status: 'ready',
  }
}

function createEditScript(): ProjectEditScript {
  return {
    id: 'edit-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    userPrompt: 'make a quiet short film',
    styleBible: null,
    durationSec: 12,
    shotCount: 1,
    status: 'ready',
    assetReviewStatus: 'pending',
    shots: [],
    generationSegments: [],
    requirements: [
      {
        id: 'req-1',
        kind: 'character',
        name: 'Pilot',
        description: 'A quiet pilot.',
        shotNumbers: [1],
        status: 'generating',
        targetId: 'character-1',
        taskTargetType: 'CharacterAppearance',
        taskTargetId: 'appearance-1',
        errorMessage: null,
        previewImageUrl: null,
      },
    ],
  }
}

describe('resource-change-sync', () => {
  it('extracts resource changes from a successful assistant tool write result', () => {
    const changes = extractWorkspaceResourceChangesFromWriteResult({
      result: {
        ok: true,
        data: createScreenplay(),
      },
      projectId: 'project-1',
      fallbackEpisodeId: 'episode-1',
    })

    expect(changes.map((change) => change.kind)).toEqual([
      WORKSPACE_RESOURCE_KIND.EDIT_SCREENPLAY,
      WORKSPACE_RESOURCE_KIND.EDIT_SCRIPT,
      WORKSPACE_RESOURCE_KIND.EDIT_SHOT_EXECUTION_PLAN,
      WORKSPACE_RESOURCE_KIND.STORYBOARDS,
      WORKSPACE_RESOURCE_KIND.EPISODE_DATA,
      WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT,
      WORKSPACE_RESOURCE_KIND.PROJECT_DATA,
    ])
  })

  it('extracts nested edit script from assistant asset generation output', () => {
    const editScript = createEditScript()
    const changes = extractWorkspaceResourceChangesFromWriteResult({
      result: {
        success: true,
        result: {
          success: true,
          async: true,
          total: 1,
          taskIds: ['task-1'],
          submittedTasks: [
            {
              requirementId: 'req-1',
              kind: 'character',
              name: 'Pilot',
              taskId: 'task-1',
              status: 'queued',
              runId: null,
              deduped: false,
              taskType: TASK_TYPE.IMAGE_CHARACTER,
              targetType: 'CharacterAppearance',
              targetId: 'appearance-1',
            },
          ],
          editScript,
        },
      },
      projectId: 'project-1',
      fallbackEpisodeId: 'episode-1',
    })

    const editScriptChange = changes.find((change) => change.kind === WORKSPACE_RESOURCE_KIND.EDIT_SCRIPT)
    expect(editScriptChange).toMatchObject({
      kind: WORKSPACE_RESOURCE_KIND.EDIT_SCRIPT,
      projectId: 'project-1',
      episodeId: 'episode-1',
    })
    expect(changes.some((change) => change.kind === WORKSPACE_RESOURCE_KIND.PROJECT_ASSETS)).toBe(true)
  })

  it('actively refetches screenplay query from successful assistant tool write result', async () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
    const refetchQueries = vi.spyOn(queryClient, 'refetchQueries').mockResolvedValue()
    const screenplay = createScreenplay()

    await syncWorkspaceResourceChangesFromWriteResult({
      queryClient,
      result: {
        success: true,
        result: screenplay,
      },
      projectId: 'project-1',
      fallbackEpisodeId: 'episode-1',
    })

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.project.editScreenplay('project-1', 'episode-1'),
    })
    expect(refetchQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.project.editScreenplay('project-1', 'episode-1'),
      type: 'active',
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.project.editScript('project-1', 'episode-1'),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.project.editShotExecutionPlan('project-1', 'episode-1'),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.storyboards.all('episode-1'),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.episodeData('project-1', 'episode-1'),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.project.context('project-1', 'episode-1'),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.projectData('project-1'),
    })
  })

  it('maps shot execution plan task completion to the full edit pipeline resources', () => {
    const changes = extractWorkspaceResourceRefsFromTaskLifecycleEvent({
      taskType: TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE,
      lifecycleType: TASK_EVENT_TYPE.COMPLETED,
      projectId: 'project-1',
      targetType: 'ProjectEditScript',
      targetId: 'edit-1',
      episodeId: null,
      payload: {
        episodeId: 'episode-1',
        shotExecutionPlanId: 'execution-1',
        editScriptId: 'edit-1',
      },
    })

    expect(changes.map((change) => change.kind)).toEqual([
      WORKSPACE_RESOURCE_KIND.EDIT_SCREENPLAY,
      WORKSPACE_RESOURCE_KIND.EDIT_SCRIPT,
      WORKSPACE_RESOURCE_KIND.EDIT_SHOT_EXECUTION_PLAN,
      WORKSPACE_RESOURCE_KIND.STORYBOARDS,
      WORKSPACE_RESOURCE_KIND.EPISODE_DATA,
      WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT,
      WORKSPACE_RESOURCE_KIND.PROJECT_DATA,
    ])
    const episodeIds = changes.flatMap((change) => {
      if ('episodeId' in change) return [change.episodeId]
      return []
    })
    expect(episodeIds).toEqual([
      'episode-1',
      'episode-1',
      'episode-1',
      'episode-1',
      'episode-1',
      'episode-1',
    ])
  })

  it('maps asset image completion to edit script resources from either task type or target type', () => {
    const byTaskType = extractWorkspaceResourceRefsFromTaskLifecycleEvent({
      taskType: TASK_TYPE.IMAGE_CHARACTER,
      lifecycleType: TASK_EVENT_TYPE.COMPLETED,
      projectId: 'project-1',
      targetType: 'CharacterAppearance',
      targetId: 'appearance-1',
      episodeId: 'episode-1',
      payload: {
        imageUrl: 'images/character.png',
      },
    })
    const byTargetType = extractWorkspaceResourceRefsFromTaskLifecycleEvent({
      taskType: null,
      lifecycleType: TASK_EVENT_TYPE.COMPLETED,
      projectId: 'project-1',
      targetType: 'LocationImage',
      targetId: 'location-image-1',
      episodeId: 'episode-1',
      payload: {
        imageUrl: 'images/location.png',
      },
    })

    for (const changes of [byTaskType, byTargetType]) {
      expect(changes.map((change) => change.kind)).toEqual([
        WORKSPACE_RESOURCE_KIND.PROJECT_ASSETS,
        WORKSPACE_RESOURCE_KIND.EDIT_SCRIPT,
        WORKSPACE_RESOURCE_KIND.EPISODE_DATA,
        WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT,
        WORKSPACE_RESOURCE_KIND.PROJECT_DATA,
      ])
      expect(changes.some((change) => (
        change.kind === WORKSPACE_RESOURCE_KIND.EDIT_SCRIPT &&
        change.episodeId === 'episode-1'
      ))).toBe(true)
    }
  })

  it('actively refetches edit script when project asset resources change for an episode', async () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
    const refetchQueries = vi.spyOn(queryClient, 'refetchQueries').mockResolvedValue()

    await syncWorkspaceResourceChanges({
      queryClient,
      changes: [
        {
          kind: WORKSPACE_RESOURCE_KIND.PROJECT_ASSETS,
          projectId: 'project-1',
          episodeId: 'episode-1',
        },
      ],
    })

    const editScriptQueryKey = queryKeys.project.editScript('project-1', 'episode-1')
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: editScriptQueryKey,
    })
    expect(refetchQueries).toHaveBeenCalledWith({
      queryKey: editScriptQueryKey,
      type: 'active',
    })
  })

  it('maps storyboard image completion to storyboard resources from either task type or target type', () => {
    const byTaskType = extractWorkspaceResourceRefsFromTaskLifecycleEvent({
      taskType: TASK_TYPE.IMAGE_PANEL,
      lifecycleType: TASK_EVENT_TYPE.COMPLETED,
      projectId: 'project-1',
      targetType: 'ProjectPanel',
      targetId: 'panel-1',
      episodeId: 'episode-1',
      payload: {
        imageUrl: 'images/panel.png',
      },
    })
    const byTargetType = extractWorkspaceResourceRefsFromTaskLifecycleEvent({
      taskType: null,
      lifecycleType: TASK_EVENT_TYPE.COMPLETED,
      projectId: 'project-1',
      targetType: 'ProjectPanel',
      targetId: 'panel-1',
      episodeId: 'episode-1',
      payload: {
        imageUrl: 'images/panel.png',
      },
    })

    for (const changes of [byTaskType, byTargetType]) {
      expect(changes.map((change) => change.kind)).toEqual([
        WORKSPACE_RESOURCE_KIND.STORYBOARDS,
        WORKSPACE_RESOURCE_KIND.EDIT_SCRIPT,
        WORKSPACE_RESOURCE_KIND.EPISODE_DATA,
        WORKSPACE_RESOURCE_KIND.PROJECT_CONTEXT,
        WORKSPACE_RESOURCE_KIND.PROJECT_DATA,
      ])
      expect(changes.some((change) => (
        change.kind === WORKSPACE_RESOURCE_KIND.STORYBOARDS &&
        change.episodeId === 'episode-1'
      ))).toBe(true)
    }
  })

  it('actively refetches storyboards when storyboard resources change', async () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
    const refetchQueries = vi.spyOn(queryClient, 'refetchQueries').mockResolvedValue()

    await syncWorkspaceResourceChanges({
      queryClient,
      changes: [
        {
          kind: WORKSPACE_RESOURCE_KIND.STORYBOARDS,
          projectId: 'project-1',
          episodeId: 'episode-1',
        },
      ],
    })

    const storyboardsQueryKey = queryKeys.storyboards.all('episode-1')
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: storyboardsQueryKey,
    })
    expect(refetchQueries).toHaveBeenCalledWith({
      queryKey: storyboardsQueryKey,
      type: 'active',
    })
  })
})
